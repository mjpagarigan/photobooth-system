import { createHash, randomUUID } from 'node:crypto';

import {
  GalleryItemSchema,
  type ConfirmUploadResponse,
  type PhotoAvailability,
} from '@grace-booth/shared';
import { describe, expect, it, vi } from 'vitest';

import type { ReadyReceipt } from '../../src/main/cloud/ready-receipt.js';
import { AppError } from '../../src/main/errors.js';
import {
  RecentGalleryService,
  localDayWindow,
} from '../../src/main/gallery/recent-gallery-service.js';
import { createTestStore, type TestStore } from './helpers.js';

const RETENTION_30_DAYS_MS = 30 * 24 * 60 * 60 * 1_000;
const AVAILABILITY_TTL_MS = 5 * 60 * 1_000;
const OFFLINE_COOLDOWN_MS = 15_000;
const DAY_NOON = new Date(2026, 10, 28, 12, 0, 0, 0).getTime();

function seedFinishedSession(
  store: TestStore,
  frameId: string,
  options: {
    completedAt: number | null;
    createdAt?: number;
    updatedAt?: number;
    jobState?: string;
    delivery?: { origin: string };
  },
): string {
  const sessionId = randomUUID();
  const createdAt = options.createdAt ?? (options.completedAt ?? DAY_NOON) - 60_000;
  const updatedAt = options.updatedAt ?? options.completedAt ?? createdAt + 60_000;
  store.repository.createSession(sessionId, createdAt);
  store.database.raw
    .prepare(
      `UPDATE sessions SET state = 'final', capture_count = 3, selected_frame_id = ?,
        completed_at = ?, updated_at = ? WHERE id = ?`,
    )
    .run(frameId, options.completedAt, updatedAt, sessionId);

  for (let i = 1; i <= 3; i++) {
    const written = store.vault.write('pending', Buffer.from(`photo-${sessionId}-${i}`));
    store.database.raw
      .prepare(
        `INSERT INTO session_assets
          (id, session_id, kind, retake_round, shot_number, encrypted_path, content_type,
            width, height, byte_size, sha256, created_at)
        VALUES (?, ?, 'capture', 0, ?, ?, 'image/jpeg', 1000, 1000, 100, ?, 1)`,
      )
      .run(randomUUID(), sessionId, i, written.relativePath, `${i}`.repeat(64));
  }

  const collageId = randomUUID();
  const collage = store.vault.write('completed', Buffer.from(`collage-${sessionId}`));
  store.database.raw
    .prepare(
      `INSERT INTO session_assets
        (id, session_id, kind, retake_round, shot_number, encrypted_path, content_type,
          width, height, byte_size, sha256, created_at)
      VALUES (?, ?, 'collage', 0, NULL, ?, 'image/jpeg', 1200, 3600, 200, ?, 1)`,
    )
    .run(collageId, sessionId, collage.relativePath, 'c'.repeat(64));
  store.database.raw
    .prepare('UPDATE sessions SET collage_asset_id = ? WHERE id = ?')
    .run(collageId, sessionId);

  if (options.jobState) {
    store.database.raw
      .prepare(
        `INSERT INTO upload_jobs
          (id, session_id, state, attempt_count, lifetime_failure_count,
            automatic_retry_index, manual_retry_cycle, created_at, updated_at)
        VALUES (?, ?, ?, 1, 1, 0, 0, 1, 1)`,
      )
      .run(randomUUID(), sessionId, options.jobState);
  }

  if (options.delivery) {
    const readyAnchor = options.completedAt ?? createdAt;
    const ready: ConfirmUploadResponse = {
      status: 'ready',
      readyAt: new Date(readyAnchor).toISOString(),
      expiresAt: new Date(readyAnchor + RETENTION_30_DAYS_MS).toISOString(),
      publicPageOrigin: options.delivery.origin,
      publicPath: '/photo',
    };
    const token = `token-${sessionId.replace(/-/g, '').slice(0, 10)}`.padEnd(43, 'a');
    const ref = store.secrets.writeNamedJson(`public-delivery-${sessionId}`, {
      version: 1,
      photoSessionId: randomUUID(),
      publicToken: token,
      ready,
    });
    store.database.raw
      .prepare('UPDATE sessions SET public_secret_ref = ? WHERE id = ?')
      .run(ref, sessionId);
  }
  return sessionId;
}

describe('localDayWindow', () => {
  it('computes half-open local calendar day boundaries across rollovers and DST dates', () => {
    for (const sampleMs of [
      DAY_NOON,
      new Date(2026, 10, 30, 23, 59, 59, 999).getTime(),
      new Date(2026, 11, 31, 12, 0, 0, 0).getTime(),
      new Date(2026, 2, 8, 12, 0, 0, 0).getTime(),
      new Date(2026, 10, 1, 12, 0, 0, 0).getTime(),
      new Date(2024, 1, 29, 18, 30, 0, 0).getTime(),
    ]) {
      const sample = new Date(sampleMs);
      const expectedStart = new Date(
        sample.getFullYear(),
        sample.getMonth(),
        sample.getDate(),
        0,
        0,
        0,
        0,
      ).getTime();
      const expectedEnd = new Date(
        sample.getFullYear(),
        sample.getMonth(),
        sample.getDate() + 1,
        0,
        0,
        0,
        0,
      ).getTime();
      const window = localDayWindow(sampleMs);
      expect(window).toEqual({ startMs: expectedStart, endMs: expectedEnd });
      expect(window.startMs).toBeLessThanOrEqual(sampleMs);
      expect(sampleMs).toBeLessThan(window.endMs);
    }

    for (const invalid of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 9e15]) {
      let caught: unknown;
      try {
        localDayWindow(invalid);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(AppError);
      expect(caught).toMatchObject({ code: 'invalid_day_window' });
    }
  });
});

describe('recent gallery service', () => {
  it('lists today sessions newest-first with media URLs, per-item QR data, and statuses', async () => {
    const store = createTestStore();
    try {
      const frameId = randomUUID();
      seedFrame(store, frameId);
      seedFrameSlots(store, frameId);

      const cloudCompletedAt = DAY_NOON + 10_000;
      const cloudUploaded = seedFinishedSession(store, frameId, {
        completedAt: cloudCompletedAt,
        jobState: 'succeeded',
        delivery: { origin: 'https://bejgkclvsfbkpkflftxu.supabase.co' },
      });
      const lanReceipt = seedFinishedSession(store, frameId, {
        completedAt: DAY_NOON + 20_000,
        jobState: 'succeeded',
        delivery: { origin: 'http://192.168.1.20:4310' },
      });
      const failedUpload = seedFinishedSession(store, frameId, {
        completedAt: DAY_NOON + 30_000,
        jobState: 'failed',
      });

      const renderedQrs: ReadyReceipt[] = [];
      const qrService = {
        render: (receipt: ReadyReceipt) => {
          renderedQrs.push(receipt);
          return Promise.resolve({
            imageDataUrl: `data:image/png;base64,qr-${receipt.publicToken}`,
            expiresAt: receipt.expiresAt,
          });
        },
      };

      const service = new RecentGalleryService({
        repository: store.repository,
        vault: store.vault,
        uploadQueue: {
          readDeliverySecret: (reference: string) => readSecret(store, reference),
        },
        qrService,
        delivery: {
          checkPhotoAvailability: () => Promise.resolve('available'),
        },
        now: () => DAY_NOON + 60_000,
      });

      const items = await service.getRecent();

      expect(items.map((item) => item.sessionId)).toEqual([
        failedUpload,
        lanReceipt,
        cloudUploaded,
      ]);
      for (const item of items) {
        GalleryItemSchema.parse(item);
        const collageId = store.repository.requireSession(item.sessionId).collageAssetId!;
        expect(item.previewUrl).toBe(`grace-booth-media://thumb/${collageId}`);
        expect(item.detailUrl).toBe(`grace-booth-media://asset/${collageId}`);
        expect(item.metadata.photoCount).toBe(3);
        expect(item.metadata.frameName).toBe('Test Frame');
      }
      expect(renderedQrs).toHaveLength(2);
      const newestItem = items[0]!;
      expect(newestItem.metadata.uploadStatus).toBe('failed');
      expect(newestItem.qrDataUrl).toBeNull();
      expect(newestItem.metadata.cloudExpiresAt).toBeNull();

      const lanItem = items.find((item) => item.sessionId === lanReceipt)!;
      const expectedLanToken = `token-${lanReceipt.replace(/-/g, '').slice(0, 10)}`.padEnd(43, 'a');
      expect(lanItem.metadata.uploadStatus).toBe('local-receipt');
      expect(lanItem.qrDataUrl).toBe(`data:image/png;base64,qr-${expectedLanToken}`);
      expect(renderedQrs.find((r) => r.publicToken === expectedLanToken)?.publicPageOrigin).toBe(
        'http://192.168.1.20:4310',
      );

      const cloudItem = items.find((item) => item.sessionId === cloudUploaded)!;
      expect(cloudItem.metadata.uploadStatus).toBe('uploaded');
      expect(cloudItem.metadata.cloudExpiresAt).toBe(cloudCompletedAt + RETENTION_30_DAYS_MS);
    } finally {
      store.close();
    }
  });

  it('returns all sessions captured within the current local day without a 20-item cap', async () => {
    const store = createTestStore();
    try {
      const frameId = randomUUID();
      seedFrame(store, frameId);
      seedFrameSlots(store, frameId);

      const expectedIds: string[] = [];
      for (let index = 0; index < 28; index += 1) {
        const createdAt = DAY_NOON - 3_600_000 + index * 60_000;
        const sessionId = seedFinishedSession(store, frameId, {
          createdAt,
          completedAt: createdAt + 10_000,
          jobState: 'succeeded',
          delivery: { origin: 'http://192.168.1.20:4310' },
        });
        expectedIds.push(sessionId);
      }
      expectedIds.reverse();

      const service = new RecentGalleryService({
        repository: store.repository,
        vault: store.vault,
        uploadQueue: {
          readDeliverySecret: (reference: string) => readSecret(store, reference),
        },
        qrService: {
          render: () =>
            Promise.resolve({ imageDataUrl: 'data:image/png;base64,qr', expiresAt: '' }),
        },
        delivery: {
          checkPhotoAvailability: () => Promise.resolve('available'),
        },
        now: () => DAY_NOON + 3_600_000,
      });

      const items = await service.getRecent();
      expect(items).toHaveLength(28);
      expect(items.map((item) => item.sessionId)).toEqual(expectedIds);
    } finally {
      store.close();
    }
  });

  it('enforces local-day created_at boundaries and includes dual-display sessions with null completed_at', async () => {
    const store = createTestStore();
    try {
      const frameId = randomUUID();
      seedFrame(store, frameId);
      seedFrameSlots(store, frameId);

      const { startMs, endMs } = localDayWindow(DAY_NOON);
      const beforeDay = seedFinishedSession(store, frameId, {
        createdAt: startMs - 1,
        completedAt: DAY_NOON + 10_000,
        updatedAt: DAY_NOON + 10_000,
        jobState: 'failed',
      });
      const atStart = seedFinishedSession(store, frameId, {
        createdAt: startMs,
        completedAt: startMs,
        jobState: 'failed',
      });
      const dualDisplayOpen = seedFinishedSession(store, frameId, {
        createdAt: startMs + 30_000,
        completedAt: null,
        updatedAt: startMs + 35_000,
        jobState: 'succeeded',
        delivery: { origin: 'http://192.168.1.20:4310' },
      });
      const beforeEnd = seedFinishedSession(store, frameId, {
        createdAt: endMs - 1,
        completedAt: endMs - 1,
        jobState: 'failed',
      });
      const atEnd = seedFinishedSession(store, frameId, {
        createdAt: endMs,
        completedAt: endMs,
        jobState: 'failed',
      });

      const service = new RecentGalleryService({
        repository: store.repository,
        vault: store.vault,
        uploadQueue: {
          readDeliverySecret: (reference: string) => readSecret(store, reference),
        },
        qrService: {
          render: () =>
            Promise.resolve({ imageDataUrl: 'data:image/png;base64,qr', expiresAt: '' }),
        },
        delivery: {
          checkPhotoAvailability: () => Promise.resolve('available'),
        },
        now: () => DAY_NOON,
      });

      const items = await service.getRecent();
      expect(items.map((item) => item.sessionId)).toEqual([beforeEnd, dualDisplayOpen, atStart]);
      expect(items.some((item) => item.sessionId === beforeDay)).toBe(false);
      expect(items.some((item) => item.sessionId === atEnd)).toBe(false);
      expect(items.find((item) => item.sessionId === dualDisplayOpen)?.metadata.uploadStatus).toBe(
        'local-receipt',
      );
    } finally {
      store.close();
    }
  });

  it('suppresses cloud QR codes when objects are missing or cannot be verified', async () => {
    const store = createTestStore();
    try {
      const frameId = randomUUID();
      seedFrame(store, frameId);
      seedFrameSlots(store, frameId);
      const unavailable = seedFinishedSession(store, frameId, {
        completedAt: DAY_NOON + 10_000,
        jobState: 'succeeded',
        delivery: { origin: 'https://photos.example.test' },
      });
      const transient = seedFinishedSession(store, frameId, {
        completedAt: DAY_NOON + 20_000,
        jobState: 'succeeded',
        delivery: { origin: 'https://photos.example.test' },
      });
      const statusByToken = new Map<string, 'unavailable' | 'verification-failed'>([
        [`token-${unavailable.replace(/-/g, '').slice(0, 10)}`.padEnd(43, 'a'), 'unavailable'],
        [
          `token-${transient.replace(/-/g, '').slice(0, 10)}`.padEnd(43, 'a'),
          'verification-failed',
        ],
      ]);
      const service = new RecentGalleryService({
        repository: store.repository,
        vault: store.vault,
        uploadQueue: {
          readDeliverySecret: (reference: string) => readSecret(store, reference),
        },
        qrService: {
          render: () =>
            Promise.resolve({
              imageDataUrl: 'data:image/png;base64,should-not-render',
              expiresAt: '',
            }),
        },
        delivery: {
          checkPhotoAvailability: (token) =>
            Promise.resolve(statusByToken.get(token) ?? 'verification-failed'),
        },
        now: () => DAY_NOON + 30_000,
      });

      const items = await service.getRecent();
      expect(items.find((item) => item.sessionId === unavailable)).toMatchObject({
        qrDataUrl: null,
        metadata: { uploadStatus: 'unavailable' },
      });
      expect(items.find((item) => item.sessionId === transient)).toMatchObject({
        qrDataUrl: null,
        metadata: { uploadStatus: 'verification-failed' },
      });
      expect(JSON.stringify(items)).not.toContain('token-');
    } finally {
      store.close();
    }
  });

  it('limits concurrent cloud availability checks to four items', async () => {
    const store = createTestStore();
    try {
      const frameId = randomUUID();
      seedFrame(store, frameId);
      seedFrameSlots(store, frameId);
      for (let index = 0; index < 9; index += 1) {
        seedFinishedSession(store, frameId, {
          createdAt: DAY_NOON + index * 1_000,
          completedAt: DAY_NOON + index * 1_000 + 500,
          jobState: 'succeeded',
          delivery: { origin: 'https://photos.example.test' },
        });
      }

      let active = 0;
      let maximumActive = 0;
      const service = new RecentGalleryService({
        repository: store.repository,
        vault: store.vault,
        uploadQueue: {
          readDeliverySecret: (reference: string) => readSecret(store, reference),
        },
        qrService: {
          render: () =>
            Promise.resolve({ imageDataUrl: 'data:image/png;base64,qr', expiresAt: '' }),
        },
        delivery: {
          checkPhotoAvailability: async () => {
            active += 1;
            maximumActive = Math.max(maximumActive, active);
            await new Promise((resolve) => setTimeout(resolve, 5));
            active -= 1;
            return 'available';
          },
        },
        now: () => DAY_NOON + 60_000,
      });

      const items = await service.getRecent();
      expect(items).toHaveLength(9);
      expect(maximumActive).toBe(4);
    } finally {
      store.close();
    }
  });

  it('caches available checks within TTL, bypasses on refresh, never caches missing items, and invalidates on rollover', async () => {
    const store = createTestStore();
    try {
      const frameId = randomUUID();
      seedFrame(store, frameId);
      seedFrameSlots(store, frameId);

      const { endMs } = localDayWindow(DAY_NOON);
      const cloudSession = seedFinishedSession(store, frameId, {
        createdAt: DAY_NOON,
        completedAt: DAY_NOON + 5_000,
        jobState: 'succeeded',
        delivery: { origin: 'https://photos.example.test' },
      });
      const lanSession = seedFinishedSession(store, frameId, {
        createdAt: DAY_NOON + 1_000,
        completedAt: DAY_NOON + 6_000,
        jobState: 'succeeded',
        delivery: { origin: 'http://192.168.1.20:4310' },
      });
      const nextDaySession = seedFinishedSession(store, frameId, {
        createdAt: endMs + 1_000,
        completedAt: endMs + 2_000,
        jobState: 'succeeded',
        delivery: { origin: 'https://photos.example.test' },
      });

      let currentNowMs = DAY_NOON + 10_000;
      let nextAvailability: PhotoAvailability = 'available';
      const checkPhotoAvailability = vi.fn(() => Promise.resolve(nextAvailability));
      const qrRender = vi.fn((receipt: ReadyReceipt) =>
        Promise.resolve({
          imageDataUrl: `data:image/png;base64,qr-${receipt.publicPageOrigin}`,
          expiresAt: receipt.expiresAt,
        }),
      );

      const service = new RecentGalleryService({
        repository: store.repository,
        vault: store.vault,
        uploadQueue: {
          readDeliverySecret: (reference: string) => readSecret(store, reference),
        },
        qrService: { render: qrRender },
        delivery: { checkPhotoAvailability },
        now: () => currentNowMs,
      });

      const initial = await service.getRecent();
      expect(initial.map((item) => item.sessionId)).toEqual([lanSession, cloudSession]);
      expect(checkPhotoAvailability).toHaveBeenCalledTimes(1);
      expect(qrRender).toHaveBeenCalledTimes(2);

      currentNowMs += AVAILABILITY_TTL_MS - 1;
      const withinTtl = await service.getRecent();
      expect(withinTtl.find((item) => item.sessionId === cloudSession)?.metadata.uploadStatus).toBe(
        'uploaded',
      );
      expect(checkPhotoAvailability).toHaveBeenCalledTimes(1);
      expect(qrRender).toHaveBeenCalledTimes(2);

      currentNowMs += 1;
      await service.getRecent();
      expect(checkPhotoAvailability).toHaveBeenCalledTimes(2);

      currentNowMs -= 10_000;
      await service.getRecent();
      expect(checkPhotoAvailability).toHaveBeenCalledTimes(3);

      currentNowMs += 20_000;
      nextAvailability = 'unavailable';
      const refreshedUnavailable = await service.getRecent({ refresh: true });
      expect(checkPhotoAvailability).toHaveBeenCalledTimes(4);
      expect(refreshedUnavailable.find((item) => item.sessionId === cloudSession)).toMatchObject({
        qrDataUrl: null,
        metadata: { uploadStatus: 'unavailable' },
      });

      nextAvailability = 'available';
      const recheckedAfterUnavailable = await service.getRecent();
      expect(checkPhotoAvailability).toHaveBeenCalledTimes(5);
      expect(
        recheckedAfterUnavailable.find((item) => item.sessionId === cloudSession)?.metadata
          .uploadStatus,
      ).toBe('uploaded');
      expect(qrRender).toHaveBeenCalledTimes(3);

      currentNowMs = endMs + 5_000;
      const rolledOver = await service.getRecent();
      expect(rolledOver.map((item) => item.sessionId)).toEqual([nextDaySession]);
      expect(checkPhotoAvailability).toHaveBeenCalledTimes(6);
      expect(qrRender).toHaveBeenCalledTimes(4);
    } finally {
      store.close();
    }
  });

  it('trips offline circuit breaker after four consecutive verification failures and resets on refresh or midnight rollover', async () => {
    const store = createTestStore();
    try {
      const frameId = randomUUID();
      seedFrame(store, frameId);
      seedFrameSlots(store, frameId);

      const { endMs } = localDayWindow(DAY_NOON);
      for (let index = 0; index < 12; index += 1) {
        seedFinishedSession(store, frameId, {
          createdAt: endMs - 60_000 + index * 1_000,
          completedAt: endMs - 55_000 + index * 1_000,
          jobState: 'succeeded',
          delivery: { origin: 'https://photos.example.test' },
        });
      }
      const nextDaySession = seedFinishedSession(store, frameId, {
        createdAt: endMs + 1_000,
        completedAt: endMs + 1_500,
        jobState: 'succeeded',
        delivery: { origin: 'https://photos.example.test' },
      });

      let currentNowMs = endMs - 30_000;
      let mode: 'fail' | 'throw' | 'available' = 'fail';
      const checkPhotoAvailability = vi.fn(() => {
        if (mode === 'throw') return Promise.reject(new Error('network down'));
        if (mode === 'fail') return Promise.resolve('verification-failed' as const);
        return Promise.resolve('available' as const);
      });

      const service = new RecentGalleryService({
        repository: store.repository,
        vault: store.vault,
        uploadQueue: {
          readDeliverySecret: (reference: string) => readSecret(store, reference),
        },
        qrService: {
          render: () =>
            Promise.resolve({ imageDataUrl: 'data:image/png;base64,qr', expiresAt: '' }),
        },
        delivery: { checkPhotoAvailability },
        now: () => currentNowMs,
      });

      const trippedItems = await service.getRecent();
      expect(trippedItems).toHaveLength(12);
      for (const item of trippedItems) {
        expect(item.qrDataUrl).toBeNull();
        expect(item.metadata.uploadStatus).toBe('verification-failed');
      }
      expect(checkPhotoAvailability.mock.calls.length).toBeGreaterThanOrEqual(4);
      expect(checkPhotoAvailability.mock.calls.length).toBeLessThanOrEqual(7);

      const callsAfterTrip = checkPhotoAvailability.mock.calls.length;
      currentNowMs += 2_000;
      const cooledDownItems = await service.getRecent();
      expect(cooledDownItems).toHaveLength(12);
      expect(checkPhotoAvailability).toHaveBeenCalledTimes(callsAfterTrip);

      currentNowMs += OFFLINE_COOLDOWN_MS;
      mode = 'throw';
      await service.getRecent();
      expect(checkPhotoAvailability.mock.calls.length).toBeGreaterThanOrEqual(callsAfterTrip + 4);
      expect(checkPhotoAvailability.mock.calls.length).toBeLessThanOrEqual(callsAfterTrip + 7);

      const callsBeforeRollover = checkPhotoAvailability.mock.calls.length;
      mode = 'available';
      currentNowMs = endMs + 2_000;
      const rolledOver = await service.getRecent();
      expect(rolledOver.map((item) => item.sessionId)).toEqual([nextDaySession]);
      expect(rolledOver[0]?.metadata.uploadStatus).toBe('uploaded');
      expect(checkPhotoAvailability).toHaveBeenCalledTimes(callsBeforeRollover + 1);
    } finally {
      store.close();
    }
  });

  it('bypasses circuit breaker cooldown when refresh is true', async () => {
    const store = createTestStore();
    try {
      const frameId = randomUUID();
      seedFrame(store, frameId);
      seedFrameSlots(store, frameId);

      for (let index = 0; index < 10; index += 1) {
        seedFinishedSession(store, frameId, {
          createdAt: DAY_NOON + index * 1_000,
          completedAt: DAY_NOON + index * 1_000 + 500,
          jobState: 'succeeded',
          delivery: { origin: 'https://photos.example.test' },
        });
      }

      let currentNowMs = DAY_NOON + 20_000;
      let status: PhotoAvailability = 'verification-failed';
      const checkPhotoAvailability = vi.fn(() => Promise.resolve(status));

      const service = new RecentGalleryService({
        repository: store.repository,
        vault: store.vault,
        uploadQueue: {
          readDeliverySecret: (reference: string) => readSecret(store, reference),
        },
        qrService: {
          render: () =>
            Promise.resolve({ imageDataUrl: 'data:image/png;base64,qr', expiresAt: '' }),
        },
        delivery: { checkPhotoAvailability },
        now: () => currentNowMs,
      });

      await service.getRecent();
      const afterTrip = checkPhotoAvailability.mock.calls.length;
      expect(afterTrip).toBeLessThan(10);

      currentNowMs += 3_000;
      status = 'available';
      const refreshed = await service.getRecent({ refresh: true });
      expect(checkPhotoAvailability).toHaveBeenCalledTimes(afterTrip + 10);
      expect(refreshed.every((item) => item.metadata.uploadStatus === 'uploaded')).toBe(true);
    } finally {
      store.close();
    }
  });

  it('repairs a missing cloud copy and invalidates that session caches', async () => {
    const store = createTestStore();
    try {
      const frameId = randomUUID();
      seedFrame(store, frameId);
      seedFrameSlots(store, frameId);
      const sessionId = seedFinishedSession(store, frameId, {
        createdAt: DAY_NOON,
        completedAt: DAY_NOON + 10_000,
        jobState: 'succeeded',
        delivery: { origin: 'https://photos.example.test' },
      });
      const session = store.repository.requireSession(sessionId);
      const collage = store.repository.getAsset(session.collageAssetId!)!;
      const bytes = store.vault.read(collage.encryptedPath);
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      store.database.raw
        .prepare('UPDATE session_assets SET byte_size = ?, sha256 = ? WHERE id = ?')
        .run(bytes.byteLength, sha256, collage.id);

      const calls: string[] = [];
      const checkPhotoAvailability = vi.fn(() => Promise.resolve('available' as const));
      const qrRender = vi.fn(() =>
        Promise.resolve({ imageDataUrl: 'data:image/png;base64,qr', expiresAt: '' }),
      );
      const service = new RecentGalleryService({
        repository: store.repository,
        vault: store.vault,
        uploadQueue: {
          readDeliverySecret: (reference: string) => readSecret(store, reference),
        },
        qrService: { render: qrRender },
        delivery: {
          checkPhotoAvailability,
          authorizePhotoRepair: (request) => {
            calls.push(`authorize:${request.metadata.sha256}`);
            return Promise.resolve({
              action: 'authorize',
              repairBatchId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
              upload: {
                storagePath: 'private/photo.jpg',
                uploadUrl: 'https://r2.example.test/repair',
                requiredHeaders: { 'content-type': 'image/jpeg', 'if-none-match': '*' },
                validForSeconds: 300,
              },
            });
          },
          uploadSigned: (_path, _token, uploaded, _url, headers) => {
            expect(Buffer.from(uploaded)).toEqual(bytes);
            expect(headers).toEqual({ 'content-type': 'image/jpeg', 'if-none-match': '*' });
            calls.push('upload');
            return Promise.resolve();
          },
          confirmPhotoRepair: (request) => {
            calls.push(`confirm:${request.repairBatchId}`);
            return Promise.resolve({
              status: 'ready',
              readyAt: '2026-08-27T00:00:00.000Z',
              expiresAt: '2026-09-26T00:00:00.000Z',
              publicPageOrigin: 'https://photos.example.test',
              publicPath: '/photo',
            });
          },
        },
        now: () => DAY_NOON + 20_000,
      });

      await service.getRecent();
      expect(checkPhotoAvailability).toHaveBeenCalledTimes(1);
      expect(qrRender).toHaveBeenCalledTimes(1);

      await expect(service.repairCloudPhoto(sessionId)).resolves.toMatchObject({
        status: 'repaired',
      });
      expect(calls).toEqual([
        `authorize:${sha256}`,
        'upload',
        'confirm:dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      ]);

      await service.getRecent();
      expect(checkPhotoAvailability).toHaveBeenCalledTimes(2);
      expect(qrRender).toHaveBeenCalledTimes(2);

      await expect(service.repairCloudPhoto(randomUUID())).resolves.toEqual({
        status: 'original-booth-required',
        message: 'Recovery requires the original booth.',
      });
    } finally {
      store.close();
    }
  });

  it('reports 4-slot photoCount from active current-round captures without counting superseded retake attempts', async () => {
    const store = createTestStore();
    try {
      const frameId = randomUUID();
      seedFrame(store, frameId);
      for (let s = 1; s <= 4; s += 1) {
        store.database.raw
          .prepare(
            `INSERT INTO frame_slots (frame_id, slot_index, z_index, name, x, y, width, height, crop_mode)
            VALUES (?, ?, ?, ?, 0, 0, 0.5, 0.5, 'crop-to-fill')`,
          )
          .run(frameId, s, s - 1, `Photo ${s}`);
      }

      const sessionId = randomUUID();
      store.repository.createSession(sessionId, DAY_NOON, frameId, 4, {
        countdownSeconds: 8,
        reviewMode: 'per_shot',
      });
      store.database.raw
        .prepare(
          `UPDATE sessions SET state = 'final', capture_round = 1, capture_count = 4,
            completed_at = ?, updated_at = ? WHERE id = ?`,
        )
        .run(DAY_NOON + 60_000, DAY_NOON + 60_000, sessionId);

      const insertCapture = store.database.raw.prepare(
        `INSERT INTO session_assets
          (id, session_id, kind, retake_round, shot_number, shot_attempt, encrypted_path,
            content_type, width, height, byte_size, sha256, created_at)
        VALUES (?, ?, 'capture', ?, ?, ?, ?, 'image/jpeg', 1000, 1000, 100, ?, 1)`,
      );
      for (let s = 1; s <= 4; s += 1) {
        const w = store.vault.write('pending', Buffer.from(`r0-${s}`));
        insertCapture.run(randomUUID(), sessionId, 0, s, 1, w.relativePath, `${s}`.repeat(64));
      }
      for (let s = 1; s <= 4; s += 1) {
        const attempts = s === 2 ? 3 : 1;
        for (let attempt = 1; attempt <= attempts; attempt += 1) {
          const w = store.vault.write('pending', Buffer.from(`r1-${s}-${attempt}`));
          insertCapture.run(
            randomUUID(),
            sessionId,
            1,
            s,
            attempt,
            w.relativePath,
            `${(s + attempt) % 10}`.repeat(64),
          );
        }
      }

      const collageId = randomUUID();
      const collage = store.vault.write('completed', Buffer.from('collage-4slot'));
      store.database.raw
        .prepare(
          `INSERT INTO session_assets
            (id, session_id, kind, retake_round, shot_number, shot_attempt, encrypted_path,
              content_type, width, height, byte_size, sha256, created_at)
          VALUES (?, ?, 'collage', 1, NULL, 1, ?, 'image/jpeg', 1800, 1200, 200, ?, 1)`,
        )
        .run(collageId, sessionId, collage.relativePath, 'e'.repeat(64));
      store.database.raw
        .prepare('UPDATE sessions SET collage_asset_id = ? WHERE id = ?')
        .run(collageId, sessionId);

      const service = new RecentGalleryService({
        repository: store.repository,
        vault: store.vault,
        uploadQueue: { readDeliverySecret: (reference) => readSecret(store, reference) },
        qrService: {
          render: () =>
            Promise.resolve({ imageDataUrl: 'data:image/png;base64,qr', expiresAt: '' }),
        },
        delivery: { checkPhotoAvailability: () => Promise.resolve('available') },
        now: () => DAY_NOON + 120_000,
      });

      const items = await service.getRecent();
      expect(items).toHaveLength(1);
      expect(items[0]!.metadata.photoCount).toBe(4);
      expect(items[0]!.metadata.printable).toBe(true);
    } finally {
      store.close();
    }
  });
});

function readSecret(
  store: TestStore,
  reference: string,
): {
  version: 1;
  photoSessionId: string;
  publicToken: string;
  ready: ConfirmUploadResponse | null;
} {
  const raw = store.secrets.getJson(reference) as {
    version?: unknown;
    photoSessionId?: unknown;
    publicToken?: unknown;
    ready?: unknown;
  } | null;
  if (raw?.version !== 1) {
    throw new Error('The photo delivery record is invalid.');
  }
  return {
    version: 1,
    photoSessionId: String(raw.photoSessionId),
    publicToken: String(raw.publicToken),
    ready: (raw.ready ?? null) as ConfirmUploadResponse | null,
  };
}

function seedFrame(store: TestStore, frameId: string): void {
  const frameVault = store.vault.write('frames', Buffer.from('frame-png'));
  store.database.raw
    .prepare(
      `INSERT INTO frames
        (id, name, encrypted_path, width, height, byte_size, sha256, revision, sort_order,
          created_at, updated_at)
      VALUES (?, 'Test Frame', ?, 1200, 3600, 100, ?, 0, 1, 1, 1)`,
    )
    .run(frameId, frameVault.relativePath, 'f'.repeat(64));
}

function seedFrameSlots(store: TestStore, frameId: string): void {
  for (let s = 1; s <= 3; s++) {
    store.database.raw
      .prepare(
        `INSERT INTO frame_slots (frame_id, slot_index, name, x, y, width, height, crop_mode)
        VALUES (?, ?, ?, 0.1, ?, 0.8, 0.2, 'crop-to-fill')`,
      )
      .run(frameId, s, `Photo ${s}`, (s - 1) * 0.3);
  }
}
