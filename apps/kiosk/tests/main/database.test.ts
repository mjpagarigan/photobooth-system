import { randomUUID } from 'node:crypto';
import { copyFileSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openBoothDatabase } from '../../src/main/database/database.js';
import { LocalRepository } from '../../src/main/database/repositories.js';
import { settings } from '../../src/main/database/schema.js';
import { afterEach, describe, expect, it } from 'vitest';

import { createTestStore, type TestStore } from './helpers.js';

const MIGRATIONS_DIR = fileURLToPath(new URL('../../migrations', import.meta.url));

let store: TestStore | null = null;
const extraTempDirs: string[] = [];
afterEach(() => {
  store?.close();
  store = null;
  while (extraTempDirs.length > 0) {
    const dir = extraTempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('checked-in local migration', () => {
  it('boots through Drizzle and enforces capture-round uniqueness', () => {
    store = createTestStore();
    expect(store.database.orm.select().from(settings).all()).toHaveLength(1);
    const sessionId = randomUUID();
    store.database.raw
      .prepare(
        `INSERT INTO sessions (id, state, capture_round, capture_count, created_at, updated_at)
        VALUES (?, 'review', 1, 4, 1, 1)`,
      )
      .run(sessionId);
    const insert = store.database.raw.prepare(
      `INSERT INTO session_assets
        (id, session_id, kind, retake_round, shot_number, encrypted_path, content_type,
          width, height, byte_size, sha256, created_at)
      VALUES (?, ?, 'capture', ?, 1, ?, 'image/jpeg', 100, 100, 10, ?, 1)`,
    );
    insert.run(randomUUID(), sessionId, 0, `pending/${randomUUID()}.gbv`, 'a'.repeat(64));
    insert.run(randomUUID(), sessionId, 1, `pending/${randomUUID()}.gbv`, 'b'.repeat(64));
    expect(() =>
      insert.run(randomUUID(), sessionId, 1, `pending/${randomUUID()}.gbv`, 'c'.repeat(64)),
    ).toThrow();
  });

  it('rejects invalid normalized slot geometry and invalid retention', () => {
    store = createTestStore();
    const frameId = randomUUID();
    store.database.raw
      .prepare(
        `INSERT INTO frames
          (id, name, encrypted_path, width, height, byte_size, sha256, revision, created_at, updated_at)
        VALUES (?, 'frame', ?, 100, 100, 10, ?, 0, 1, 1)`,
      )
      .run(frameId, `frames/${randomUUID()}.gbv`, 'd'.repeat(64));
    expect(() =>
      store?.database.raw
        .prepare(
          `INSERT INTO frame_slots
            (frame_id, slot_index, name, x, y, width, height, crop_mode)
          VALUES (?, 1, 'bad', 0.9, 0, 0.2, 1, 'fit')`,
        )
        .run(frameId),
    ).toThrow();
    expect(() =>
      store?.database.raw
        .prepare('UPDATE settings SET local_retention_days = 30 WHERE id = 1')
        .run(),
    ).toThrow();
  });

  it('defaults camera resolution and zoom and persists camera preferences', () => {
    store = createTestStore();
    expect(store.repository.getSettings().cameraResolution).toBe('1080p');
    expect(store.repository.getSettings().cameraZoomPercent).toBe(100);
    expect(store.repository.getSettings().webcamAlwaysActive).toBe(false);
    expect(store.repository.getSettings().recruitmentButtonText).toBe('Join a ministry');

    const updated = store.repository.setCameraSettings(
      'webcam',
      'camo-camera',
      '720p',
      1_000,
      true,
      135,
    );
    expect(updated.cameraAdapter).toBe('webcam');
    expect(updated.cameraDeviceId).toBe('camo-camera');
    expect(updated.cameraResolution).toBe('720p');
    expect(updated.cameraZoomPercent).toBe(135);
    expect(updated.webcamAlwaysActive).toBe(true);
    expect(store.repository.setCameraSettings('webcam').cameraZoomPercent).toBe(135);
    expect(() =>
      store?.database.raw
        .prepare("UPDATE settings SET camera_resolution = '480p' WHERE id = 1")
        .run(),
    ).toThrow();
  });

  it('persists collage_2_frame_id on settings and selectedOption/selectedFrameId on sessions', () => {
    store = createTestStore();
    const frame1Id = randomUUID();
    const frame2Id = randomUUID();
    store.repository.setCollageFrameId(1, frame1Id);
    store.repository.setCollageFrameId(2, frame2Id);

    const settingsRow = store.repository.getSettings();
    expect(settingsRow.activeFrameId).toBe(frame1Id);
    expect(settingsRow.collage2FrameId).toBe(frame2Id);

    const sessionId = randomUUID();
    store.repository.createSession(sessionId, 1_000);
    const session = store.repository.transitionSession(sessionId, ['countdown'], 'review', {
      selectedOption: 2,
      selectedFrameId: frame2Id,
    });
    expect(session.selectedOption).toBe(2);
    expect(session.selectedFrameId).toBe(frame2Id);

    const retaken = store.repository.startRetakeRound(sessionId, 2_000);
    expect(retaken.selectedOption).toBe(1);
    expect(retaken.selectedFrameId).toBe(frame2Id);
    expect(retaken.requiredShotCount).toBe(3);
  });

  it('upgrades a 0000..0012 database to 0013 without cascade-deleting child rows and restores FK enforcement', () => {
    const workDir = mkdtempSync(join(tmpdir(), 'grace-booth-upgrade-'));
    extraTempDirs.push(workDir);
    const preMigrationsDir = mkdtempSync(join(tmpdir(), 'grace-booth-pre13-'));
    extraTempDirs.push(preMigrationsDir);

    for (const file of readdirSync(MIGRATIONS_DIR)) {
      if (file.endsWith('.sql') && file < '0013_') {
        copyFileSync(join(MIGRATIONS_DIR, file), join(preMigrationsDir, file));
      }
    }

    const dbPath = join(workDir, 'booth.sqlite');
    const frameId = randomUUID();
    const sessionId = randomUUID();
    const captureAssetId = randomUUID();
    const collageAssetId = randomUUID();
    const uploadJobId = randomUUID();
    const printJobId = randomUUID();

    const preDb = openBoothDatabase(dbPath, preMigrationsDir);
    try {
      preDb.raw
        .prepare(
          `INSERT INTO frames
            (id, name, encrypted_path, width, height, byte_size, sha256, revision, created_at, updated_at)
          VALUES (?, 'Pre-upgrade Frame', 'frames/pre.gbv', 1800, 1200, 100, ?, 0, 1, 1)`,
        )
        .run(frameId, 'a'.repeat(64));
      preDb.raw
        .prepare(
          `INSERT INTO frame_slots (frame_id, slot_index, z_index, name, x, y, width, height, crop_mode)
          VALUES (?, 1, 0, 'Photo 1', 0.1, 0.1, 0.8, 0.8, 'crop-to-fill')`,
        )
        .run(frameId);
      preDb.raw
        .prepare(
          `INSERT INTO sessions
            (id, state, capture_round, capture_count, required_shot_count, selected_frame_id,
              collage_asset_id, created_at, updated_at)
          VALUES (?, 'final', 0, 1, 1, ?, ?, 100, 200)`,
        )
        .run(sessionId, frameId, collageAssetId);
      preDb.raw
        .prepare(
          `INSERT INTO session_assets
            (id, session_id, kind, retake_round, shot_number, encrypted_path, content_type,
              width, height, byte_size, sha256, created_at)
          VALUES
            (?, ?, 'capture', 0, 1, 'pending/c1.gbv', 'image/jpeg', 1000, 1000, 50, ?, 100),
            (?, ?, 'collage', 0, NULL, 'completed/col1.gbv', 'image/jpeg', 1800, 1200, 80, ?, 150)`,
        )
        .run(captureAssetId, sessionId, 'b'.repeat(64), collageAssetId, sessionId, 'c'.repeat(64));
      preDb.raw
        .prepare(
          `INSERT INTO upload_jobs
            (id, session_id, state, attempt_count, lifetime_failure_count,
              automatic_retry_index, manual_retry_cycle, created_at, updated_at)
          VALUES (?, ?, 'succeeded', 1, 0, 0, 0, 150, 200)`,
        )
        .run(uploadJobId, sessionId);
      preDb.raw
        .prepare(
          `INSERT INTO print_jobs
            (id, request_id, session_id, source_asset_id, kind, copy_index, copy_count, state,
              document_key, attempt_count, created_at, updated_at)
          VALUES (?, ?, ?, ?, 'session', 1, 1, 'printed', ?, 1, 150, 200)`,
        )
        .run(printJobId, randomUUID(), sessionId, collageAssetId, `GraceBooth-${printJobId}`);
    } finally {
      preDb.close();
    }

    const upgraded = openBoothDatabase(dbPath, MIGRATIONS_DIR);
    try {
      expect(upgraded.raw.pragma('foreign_keys', { simple: true })).toBe(1);
      expect(upgraded.raw.pragma('foreign_key_check')).toEqual([]);

      const repo = new LocalRepository(upgraded);
      const migratedSettings = repo.getSettings();
      expect(migratedSettings.captureCountdownSeconds).toBe(8);
      expect(migratedSettings.captureReviewMode).toBe('per_shot');

      const migratedSession = repo.requireSession(sessionId);
      expect(migratedSession.captureReviewMode).toBe('continuous');
      expect(migratedSession.captureCountdownSeconds).toBe(8);
      expect(migratedSession.requiredShotCount).toBe(1);

      const assets = repo.listAssets(sessionId);
      expect(assets).toHaveLength(2);
      expect(assets.every((asset) => asset.shotAttempt === 1)).toBe(true);
      expect(repo.getUploadJob(uploadJobId)).not.toBeNull();
      expect(
        upgraded.raw.prepare('SELECT id FROM print_jobs WHERE id = ?').get(printJobId),
      ).toEqual({ id: printJobId });

      const tenSlotFrameId = randomUUID();
      upgraded.raw
        .prepare(
          `INSERT INTO frames
            (id, name, encrypted_path, width, height, byte_size, sha256, revision, created_at, updated_at)
          VALUES (?, 'Ten Slot Frame', 'frames/ten.gbv', 1800, 1200, 100, ?, 0, 1, 1)`,
        )
        .run(tenSlotFrameId, 'd'.repeat(64));
      for (let slot = 1; slot <= 10; slot += 1) {
        upgraded.raw
          .prepare(
            `INSERT INTO frame_slots (frame_id, slot_index, z_index, name, x, y, width, height, crop_mode)
            VALUES (?, ?, ?, ?, 0, 0, 0.1, 0.1, 'crop-to-fill')`,
          )
          .run(tenSlotFrameId, slot, slot - 1, `Photo ${slot}`);
      }
      expect(repo.getFrame(tenSlotFrameId)?.slots).toHaveLength(10);

      const tenShotSession = repo.createSession(randomUUID(), 500, tenSlotFrameId, 10, {
        countdownSeconds: 6,
        reviewMode: 'continuous',
      });
      for (let shot = 1; shot <= 10; shot += 1) {
        repo.transitionSession(tenShotSession.id, ['countdown'], 'capturing', {}, 500 + shot);
        repo.addCapture(
          {
            id: randomUUID(),
            sessionId: tenShotSession.id,
            kind: 'capture',
            retakeRound: 0,
            shotNumber: shot,
            encryptedPath: `pending/ten-${shot}.gbv`,
            width: 1000,
            height: 1000,
            byteSize: 50,
            sha256: `${shot % 10}`.repeat(64),
            createdAt: 500 + shot,
          },
          500 + shot,
        );
      }
      expect(repo.requireSession(tenShotSession.id)).toMatchObject({
        state: 'review',
        captureCount: 10,
        requiredShotCount: 10,
      });

      expect(() =>
        upgraded.raw
          .prepare("UPDATE sessions SET state = 'shot_review' WHERE id = ?")
          .run(tenShotSession.id),
      ).toThrow();
    } finally {
      upgraded.close();
    }
  });

  it('persists capture settings with optimistic locking and audit logging', () => {
    store = createTestStore();
    const initial = store.repository.getSettings();
    expect(initial.captureCountdownSeconds).toBe(8);
    expect(initial.captureReviewMode).toBe('per_shot');

    const updated = store.repository.setCaptureSettings(
      { countdownSeconds: 12, reviewMode: 'continuous', expectedRevision: initial.revision },
      1_500,
    );
    expect(updated.captureCountdownSeconds).toBe(12);
    expect(updated.captureReviewMode).toBe('continuous');
    expect(updated.revision).toBe(initial.revision + 1);

    expect(() =>
      store?.repository.setCaptureSettings(
        { countdownSeconds: 5, reviewMode: 'per_shot', expectedRevision: initial.revision },
        2_000,
      ),
    ).toThrow(/Settings changed elsewhere/i);

    const audit = store.database.raw
      .prepare(
        "SELECT operation, outcome, detail_code FROM audit_log WHERE detail_code = 'capture_settings_updated'",
      )
      .all();
    expect(audit).toEqual([
      { operation: 'settings_change', outcome: 'success', detail_code: 'capture_settings_updated' },
    ]);
  });

  it('allows background Google Photos cache sync without invalidating pending settings revisions', () => {
    store = createTestStore();
    const initial = store.repository.getSettings();
    const synced = store.repository.setGooglePhotosConfig(
      {
        enabled: true,
        connectedEmail: 'operator@example.com',
        albumId: 'album-1',
        albumTitle: 'Event Album',
        albumShareUrl: 'https://photos.app.goo.gl/test',
      },
      1_500,
      { bumpRevision: false },
    );
    expect(synced.googlePhotosEnabled).toBe(true);
    expect(synced.googlePhotosEmail).toBe('operator@example.com');
    expect(synced.revision).toBe(initial.revision);

    const saved = store.repository.setCaptureSettings(
      { countdownSeconds: 1, reviewMode: 'continuous', expectedRevision: initial.revision },
      2_000,
    );
    expect(saved.captureCountdownSeconds).toBe(1);
    expect(saved.captureReviewMode).toBe('continuous');
    expect(saved.revision).toBe(initial.revision + 1);
  });

  it('tracks non-destructive per-shot retake attempts and resolves only winning shots in listCurrentAssets', () => {
    store = createTestStore();
    const sessionId = randomUUID();
    store.repository.createSession(sessionId, 1_000, null, 2, {
      countdownSeconds: 8,
      reviewMode: 'per_shot',
    });

    const captureAttempt = (shotNumber: number, tag: string) => {
      store!.repository.transitionSession(sessionId, ['countdown'], 'capturing', {}, 1_100);
      const assetId = randomUUID();
      const updated = store!.repository.addCapture(
        {
          id: assetId,
          sessionId,
          kind: 'capture',
          retakeRound: 0,
          shotNumber,
          encryptedPath: `pending/${tag}.gbv`,
          width: 1000,
          height: 1000,
          byteSize: 50,
          sha256: tag.padEnd(64, 'a').slice(0, 64),
          createdAt: 1_100,
        },
        1_100,
      );
      return { assetId, updated };
    };

    const shot1First = captureAttempt(1, 's1-a1');
    expect(shot1First.updated).toMatchObject({ state: 'shot_review', captureCount: 0 });
    expect(store.repository.listCurrentAssets(sessionId).map((a) => a.id)).toEqual([
      shot1First.assetId,
    ]);

    const retaking = store.repository.retakeShot(sessionId, 1, 1_200);
    expect(retaking).toMatchObject({ state: 'countdown', captureCount: 0 });
    expect(store.repository.listCurrentAssets(sessionId)).toEqual([]);

    const shot1Second = captureAttempt(1, 's1-a2');
    expect(shot1Second.updated).toMatchObject({ state: 'shot_review', captureCount: 0 });
    expect(store.repository.getAsset(shot1Second.assetId)?.shotAttempt).toBe(2);
    expect(store.repository.listAssets(sessionId)).toHaveLength(2);
    expect(store.repository.listCurrentAssets(sessionId).map((a) => a.id)).toEqual([
      shot1Second.assetId,
    ]);

    const afterAccept1 = store.repository.acceptShot(sessionId, 1, 1_300);
    expect(afterAccept1).toMatchObject({ state: 'countdown', captureCount: 1 });
    expect(store.repository.listCurrentAssets(sessionId).map((a) => a.id)).toEqual([
      shot1Second.assetId,
    ]);

    const shot2 = captureAttempt(2, 's2-a1');
    expect(shot2.updated).toMatchObject({ state: 'shot_review', captureCount: 1 });
    expect(store.repository.listCurrentAssets(sessionId).map((a) => a.id)).toEqual([
      shot1Second.assetId,
      shot2.assetId,
    ]);

    const afterAccept2 = store.repository.acceptShot(sessionId, 2, 1_400);
    expect(afterAccept2).toMatchObject({ state: 'review', captureCount: 2 });
    expect(store.repository.listAssets(sessionId)).toHaveLength(3);
    expect(store.repository.listCurrentAssets(sessionId).map((a) => a.id)).toEqual([
      shot1Second.assetId,
      shot2.assetId,
    ]);
  });
});
