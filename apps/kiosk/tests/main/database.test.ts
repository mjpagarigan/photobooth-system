import { randomUUID } from 'node:crypto';

import { settings } from '../../src/main/database/schema.js';
import { afterEach, describe, expect, it } from 'vitest';

import { createTestStore, type TestStore } from './helpers.js';

let store: TestStore | null = null;
afterEach(() => {
  store?.close();
  store = null;
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

  it('defaults camera resolution to 1080p and persists a 720p preference', () => {
    store = createTestStore();
    expect(store.repository.getSettings().cameraResolution).toBe('1080p');

    const updated = store.repository.setCameraSettings('webcam', 'camo-camera', '720p', 1_000);
    expect(updated.cameraAdapter).toBe('webcam');
    expect(updated.cameraDeviceId).toBe('camo-camera');
    expect(updated.cameraResolution).toBe('720p');
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
});
