import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';

import type { ConfirmUploadResponse } from '@grace-booth/shared';
import { describe, expect, it } from 'vitest';

import type { ReadyReceipt } from '../../src/main/cloud/ready-receipt.js';
import { RecentGalleryService } from '../../src/main/gallery/recent-gallery-service.js';
import type { ImageProcessor } from '../../src/main/image/image-worker-client.js';
import { createTestStore, type TestStore } from './helpers.js';

const RETENTION_30_DAYS_MS = 30 * 24 * 60 * 60 * 1_000;

function seedFinishedSession(
  store: TestStore,
  frameId: string,
  options: {
    completedAt: number;
    jobState?: string;
    delivery?: { origin: string };
  },
): string {
  const sessionId = randomUUID();
  store.repository.createSession(sessionId, options.completedAt - 60_000);
  store.database.raw
    .prepare(
      `UPDATE sessions SET state = 'final', capture_count = 3, selected_frame_id = ?,
        completed_at = ?, updated_at = ? WHERE id = ?`,
    )
    .run(frameId, options.completedAt, options.completedAt, sessionId);

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
    const ready: ConfirmUploadResponse = {
      status: 'ready',
      readyAt: new Date(options.completedAt).toISOString(),
      expiresAt: new Date(options.completedAt + RETENTION_30_DAYS_MS).toISOString(),
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

describe('recent gallery service', () => {
  it('lists finished sessions newest-first with previews, per-item QR data, and statuses', async () => {
    const store = createTestStore();
    try {
      const frameId = randomUUID();
      seedFrame(store, frameId);
      seedFrameSlots(store, frameId);

      const cloudUploaded = seedFinishedSession(store, frameId, {
        completedAt: 2_000_000,
        jobState: 'succeeded',
        delivery: { origin: 'https://bejgkclvsfbkpkflftxu.supabase.co' },
      });
      const lanReceipt = seedFinishedSession(store, frameId, {
        completedAt: 3_000_000,
        jobState: 'succeeded',
        delivery: { origin: 'http://192.168.1.20:4310' },
      });
      const failedUpload = seedFinishedSession(store, frameId, {
        completedAt: 4_000_000,
        jobState: 'failed',
      });

      const renderedQrs: ReadyReceipt[] = [];
      const imageProcessor: ImageProcessor = {
        process: () => Promise.reject(new Error('process should not be called')),
        validateSourceJpeg: () => Promise.reject(new Error('not used')),
        normalizeFramePng: () => Promise.reject(new Error('not used')),
        createThumbnail: (bytes) =>
          Promise.resolve({
            bytes: Buffer.from(`preview:${bytes.length}`),
            width: 360,
            height: 1080,
          }),
        close: () => Promise.resolve(),
      };
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
        imageProcessor,
        delivery: {
          checkPhotoAvailability: () => Promise.resolve('available'),
        },
      });

      const items = await service.getRecent(20);

      expect(items.map((item) => item.sessionId)).toEqual([
        failedUpload,
        lanReceipt,
        cloudUploaded,
      ]);
      // Each item carries a small thumbnailed preview of the stored collage.
      for (const item of items) {
        expect(item.previewDataUrl.startsWith('data:image/jpeg;base64,')).toBe(true);
        expect(item.metadata.photoCount).toBe(3);
        expect(item.metadata.frameName).toBe('Test Frame');
      }
      // QR receipts resolve each item's own token at its LAN/cloud origin.
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
      expect(cloudItem.metadata.cloudExpiresAt).toBe(2_000_000 + RETENTION_30_DAYS_MS);
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
        completedAt: 2_000_000,
        jobState: 'succeeded',
        delivery: { origin: 'https://photos.example.test' },
      });
      const transient = seedFinishedSession(store, frameId, {
        completedAt: 3_000_000,
        jobState: 'succeeded',
        delivery: { origin: 'https://photos.example.test' },
      });
      const statusByToken = new Map<string, 'unavailable' | 'verification-failed'>([
        [`token-${unavailable.replace(/-/g, '').slice(0, 10)}`.padEnd(43, 'a'), 'unavailable'],
        [`token-${transient.replace(/-/g, '').slice(0, 10)}`.padEnd(43, 'a'), 'verification-failed'],
      ]);
      const service = new RecentGalleryService({
        repository: store.repository,
        vault: store.vault,
        uploadQueue: {
          readDeliverySecret: (reference: string) => readSecret(store, reference),
        },
        qrService: {
          render: () => Promise.resolve({ imageDataUrl: 'data:image/png;base64,should-not-render', expiresAt: '' }),
        },
        imageProcessor: {
          process: () => Promise.reject(new Error('not used')),
          validateSourceJpeg: () => Promise.reject(new Error('not used')),
          normalizeFramePng: () => Promise.reject(new Error('not used')),
          createThumbnail: (bytes) =>
            Promise.resolve({ bytes: Buffer.from(bytes), width: 360, height: 1080 }),
          close: () => Promise.resolve(),
        },
        delivery: {
          checkPhotoAvailability: (token) =>
            Promise.resolve(statusByToken.get(token) ?? 'verification-failed'),
        },
      });

      const items = await service.getRecent(20);
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
          completedAt: 2_000_000 + index,
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
          render: () => Promise.resolve({ imageDataUrl: 'data:image/png;base64,qr', expiresAt: '' }),
        },
        imageProcessor: {
          process: () => Promise.reject(new Error('not used')),
          validateSourceJpeg: () => Promise.reject(new Error('not used')),
          normalizeFramePng: () => Promise.reject(new Error('not used')),
          createThumbnail: (bytes) =>
            Promise.resolve({ bytes: Buffer.from(bytes), width: 360, height: 1080 }),
          close: () => Promise.resolve(),
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
      });

      const items = await service.getRecent(20);
      expect(items).toHaveLength(9);
      expect(maximumActive).toBe(4);
    } finally {
      store.close();
    }
  });

  it('repairs a missing cloud copy from the verified encrypted local collage', async () => {
    const store = createTestStore();
    try {
      const frameId = randomUUID();
      seedFrame(store, frameId);
      seedFrameSlots(store, frameId);
      const sessionId = seedFinishedSession(store, frameId, {
        completedAt: 4_000_000,
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
      const service = new RecentGalleryService({
        repository: store.repository,
        vault: store.vault,
        uploadQueue: {
          readDeliverySecret: (reference: string) => readSecret(store, reference),
        },
        qrService: { render: () => Promise.reject(new Error('not used')) },
        imageProcessor: {
          process: () => Promise.reject(new Error('not used')),
          validateSourceJpeg: () => Promise.reject(new Error('not used')),
          normalizeFramePng: () => Promise.reject(new Error('not used')),
          createThumbnail: () => Promise.reject(new Error('not used')),
          close: () => Promise.resolve(),
        },
        delivery: {
          checkPhotoAvailability: () => Promise.resolve('unavailable'),
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
      });

      await expect(service.repairCloudPhoto(sessionId)).resolves.toMatchObject({
        status: 'repaired',
      });
      expect(calls).toEqual([
        `authorize:${sha256}`,
        'upload',
        'confirm:dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      ]);
      await expect(service.repairCloudPhoto(randomUUID())).resolves.toEqual({
        status: 'original-booth-required',
        message: 'Recovery requires the original booth.',
      });
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
