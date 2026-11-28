import { randomUUID } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { readMediaResponse } from '../../src/main/security/protocols.js';
import {
  MAX_THUMBNAIL_CACHE,
  MediaService,
  THUMBNAIL_MAX_EDGE,
  THUMBNAIL_QUALITY,
} from '../../src/main/storage/media-service.js';
import { createTestStore, type TestStore } from './helpers.js';

vi.mock('electron', () => ({
  protocol: {
    handle: vi.fn(),
    registerSchemesAsPrivileged: vi.fn(),
  },
}));

let store: TestStore | null = null;

afterEach(() => {
  store?.close();
  store = null;
});

function seedAsset(
  testStore: TestStore,
  options: {
    kind: 'capture' | 'collage';
    payload: Uint8Array;
    cleanupState?: 'active' | 'tombstoning' | 'tombstoned';
  },
): string {
  const sessionId = randomUUID();
  const assetId = randomUUID();
  testStore.repository.createSession(sessionId, 1_000_000);
  const vaultKind = options.kind === 'collage' ? 'completed' : 'pending';
  const written = testStore.vault.write(vaultKind, options.payload);
  testStore.database.raw
    .prepare(
      `INSERT INTO session_assets
        (id, session_id, kind, retake_round, shot_number, encrypted_path, content_type,
          width, height, byte_size, sha256, created_at)
      VALUES (?, ?, ?, 0, ?, ?, 'image/jpeg', 1200, 1800, ?, ?, 1000000)`,
    )
    .run(
      assetId,
      sessionId,
      options.kind,
      options.kind === 'capture' ? 1 : null,
      written.relativePath,
      written.byteSize,
      written.sha256,
    );
  if (options.cleanupState && options.cleanupState !== 'active') {
    const tombstone = testStore.vault.createTombstoneReference();
    testStore.repository.prepareAssetTombstone(assetId, tombstone);
    if (options.cleanupState === 'tombstoned') {
      testStore.repository.markAssetTombstoned(assetId);
    }
  }
  return assetId;
}

describe('MediaService', () => {
  it('reads active assets and frames while rejecting tombstoning assets', () => {
    store = createTestStore();
    const activeBytes = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    const tombstoningBytes = Buffer.from([0xff, 0xd8, 0xff, 0x01]);
    const activeId = seedAsset(store, { kind: 'collage', payload: activeBytes });
    const tombstoningId = seedAsset(store, {
      kind: 'collage',
      payload: tombstoningBytes,
      cleanupState: 'tombstoning',
    });

    const frameId = randomUUID();
    const framePng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const writtenFrame = store.vault.write('frames', framePng);
    store.database.raw
      .prepare(
        `INSERT INTO frames
          (id, name, encrypted_path, width, height, byte_size, sha256, revision, sort_order,
            created_at, updated_at)
        VALUES (?, 'Test Frame', ?, 1200, 3600, ?, ?, 0, 1, 1, 1)`,
      )
      .run(frameId, writtenFrame.relativePath, writtenFrame.byteSize, writtenFrame.sha256);
    for (let slot = 1; slot <= 3; slot += 1) {
      store.database.raw
        .prepare(
          `INSERT INTO frame_slots (frame_id, slot_index, name, x, y, width, height, crop_mode)
          VALUES (?, ?, ?, 0.1, ?, 0.8, 0.2, 'crop-to-fill')`,
        )
        .run(frameId, slot, `Photo ${slot}`, (slot - 1) * 0.3);
    }

    const media = new MediaService(store.repository, store.vault);

    expect(media.read(activeId)).toEqual({ bytes: activeBytes, contentType: 'image/jpeg' });
    expect(media.read(frameId)).toEqual({ bytes: framePng, contentType: 'image/png' });
    expect(() => media.read(tombstoningId)).toThrow(/unavailable/i);
  });

  it('rejects non-collage captures and tombstoned collages in readThumbnail', async () => {
    store = createTestStore();
    const captureId = seedAsset(store, {
      kind: 'capture',
      payload: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
    });
    const tombstoningId = seedAsset(store, {
      kind: 'collage',
      payload: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
      cleanupState: 'tombstoning',
    });
    const tombstonedId = seedAsset(store, {
      kind: 'collage',
      payload: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
      cleanupState: 'tombstoned',
    });

    const createThumbnail = vi.fn(() =>
      Promise.resolve({ bytes: Buffer.from('thumb'), width: 480, height: 320 }),
    );
    const media = new MediaService(store.repository, store.vault, { createThumbnail });

    await expect(media.readThumbnail(captureId)).rejects.toThrow(/unavailable/i);
    await expect(media.readThumbnail(tombstoningId)).rejects.toThrow(/unavailable/i);
    await expect(media.readThumbnail(tombstonedId)).rejects.toThrow(/unavailable/i);
    await expect(media.readThumbnail(randomUUID())).rejects.toThrow(/unavailable/i);
    expect(createThumbnail).not.toHaveBeenCalled();
  });

  it('caches thumbnails in memory, skips vault/worker on hit, and evicts on tombstone', async () => {
    store = createTestStore();
    const collageBytes = await sharp({
      create: { width: 960, height: 640, channels: 3, background: '#3159b8' },
    })
      .jpeg({ quality: 95 })
      .toBuffer();
    const collageId = seedAsset(store, { kind: 'collage', payload: collageBytes });

    const vaultReadSpy = vi.spyOn(store.vault, 'read');
    const createThumbnail = vi.fn(() =>
      Promise.resolve({ bytes: Buffer.from('thumb-jpeg'), width: 480, height: 320 }),
    );
    const media = new MediaService(store.repository, store.vault, { createThumbnail });

    const first = await media.readThumbnail(collageId);
    const second = await media.readThumbnail(collageId);

    expect(first).toEqual({ bytes: Buffer.from('thumb-jpeg'), contentType: 'image/jpeg' });
    expect(second).toEqual({ bytes: Buffer.from('thumb-jpeg'), contentType: 'image/jpeg' });
    expect(createThumbnail).toHaveBeenCalledTimes(1);
    expect(createThumbnail).toHaveBeenCalledWith(
      collageBytes,
      THUMBNAIL_MAX_EDGE,
      THUMBNAIL_QUALITY,
    );
    expect(vaultReadSpy).toHaveBeenCalledTimes(1);

    const rootEntriesBefore = listAllFiles(store.paths.root);
    expect(
      rootEntriesBefore.every((entry) => entry.endsWith('.gbv') || !entry.includes('thumb')),
    ).toBe(true);

    store.repository.prepareAssetTombstone(collageId, store.vault.createTombstoneReference());
    await expect(media.readThumbnail(collageId)).rejects.toThrow(/unavailable/i);
  });

  it('resizes directly with createThumbnailJpeg when imageProcessor is omitted', async () => {
    store = createTestStore();
    const collageBytes = await sharp({
      create: { width: 960, height: 640, channels: 3, background: '#c94a29' },
    })
      .jpeg({ quality: 95 })
      .toBuffer();
    const collageId = seedAsset(store, { kind: 'collage', payload: collageBytes });
    const media = new MediaService(store.repository, store.vault);

    const thumbnail = await media.readThumbnail(collageId);
    const metadata = await sharp(thumbnail.bytes).metadata();
    expect(thumbnail.contentType).toBe('image/jpeg');
    expect(metadata.format).toBe('jpeg');
    expect(metadata.width).toBe(480);
    expect(metadata.height).toBe(320);
  });

  it('evicts the least recently used entry after passing the 250-entry LRU cap', async () => {
    store = createTestStore();
    const assetIds: string[] = [];
    store.database.raw.transaction(() => {
      for (let index = 0; index <= MAX_THUMBNAIL_CACHE; index += 1) {
        assetIds.push(
          seedAsset(store!, {
            kind: 'collage',
            payload: Buffer.from(`collage-${index}`),
          }),
        );
      }
    })();

    let thumbnailCalls = 0;
    const media = new MediaService(store.repository, store.vault, {
      createThumbnail: (raw) => {
        thumbnailCalls += 1;
        return Promise.resolve({
          bytes: Buffer.from(`thumb-${raw.toString()}`),
          width: 480,
          height: 320,
        });
      },
    });

    for (let index = 0; index < MAX_THUMBNAIL_CACHE; index += 1) {
      await media.readThumbnail(assetIds[index]!);
    }
    expect(thumbnailCalls).toBe(MAX_THUMBNAIL_CACHE);

    await media.readThumbnail(assetIds[0]!);
    expect(thumbnailCalls).toBe(MAX_THUMBNAIL_CACHE);

    await media.readThumbnail(assetIds[MAX_THUMBNAIL_CACHE]!);
    expect(thumbnailCalls).toBe(MAX_THUMBNAIL_CACHE + 1);

    await media.readThumbnail(assetIds[0]!);
    expect(thumbnailCalls).toBe(MAX_THUMBNAIL_CACHE + 1);

    await media.readThumbnail(assetIds[1]!);
    expect(thumbnailCalls).toBe(MAX_THUMBNAIL_CACHE + 2);
  });

  it('deduplicates concurrent requests for the same collage and bounds Sharp concurrency to 4', async () => {
    store = createTestStore();
    const sharedId = seedAsset(store, { kind: 'collage', payload: Buffer.from('shared') });
    const batchIds = Array.from({ length: 10 }, (_, index) =>
      seedAsset(store!, { kind: 'collage', payload: Buffer.from(`batch-${index}`) }),
    );

    let active = 0;
    let peakActive = 0;
    const gates: (() => void)[] = [];
    const createThumbnail = vi.fn(
      (raw: Uint8Array) =>
        new Promise<{ bytes: Buffer; width: number; height: number }>((resolve) => {
          active += 1;
          peakActive = Math.max(peakActive, active);
          gates.push(() => {
            active -= 1;
            resolve({
              bytes: Buffer.from(`out-${Buffer.from(raw).toString()}`),
              width: 480,
              height: 320,
            });
          });
        }),
    );

    const media = new MediaService(store.repository, store.vault, { createThumbnail });

    const duplicateCalls = Promise.all([
      media.readThumbnail(sharedId),
      media.readThumbnail(sharedId),
      media.readThumbnail(sharedId),
    ]);
    await waitForCondition(() => gates.length === 1);
    expect(createThumbnail).toHaveBeenCalledTimes(1);
    gates.shift()!();
    const duplicateResults = await duplicateCalls;
    for (const result of duplicateResults) {
      expect(result.bytes.toString()).toBe('out-shared');
    }

    createThumbnail.mockClear();
    const batchPromise = Promise.all(batchIds.map((id) => media.readThumbnail(id)));
    await waitForCondition(() => gates.length === 4);
    expect(peakActive).toBe(4);
    expect(createThumbnail).toHaveBeenCalledTimes(4);

    while (gates.length > 0 || active > 0 || createThumbnail.mock.calls.length < 10) {
      const release = gates.shift();
      if (release) {
        release();
      }
      await new Promise((resolve) => setTimeout(resolve, 1));
    }

    const batchResults = await batchPromise;
    expect(peakActive).toBeLessThanOrEqual(4);
    expect(createThumbnail).toHaveBeenCalledTimes(10);
    batchResults.forEach((result, index) => {
      expect(result.bytes.toString()).toBe(`out-batch-${index}`);
    });
  });

  it('serves both asset and thumb protocol requests with security headers', async () => {
    store = createTestStore();
    const collageBytes = Buffer.from('full-collage');
    const collageId = seedAsset(store, { kind: 'collage', payload: collageBytes });
    const captureId = seedAsset(store, { kind: 'capture', payload: Buffer.from('capture') });
    const media = new MediaService(store.repository, store.vault, {
      createThumbnail: () =>
        Promise.resolve({ bytes: Buffer.from('thumb-bytes'), width: 480, height: 320 }),
    });

    const assetResponse = await readMediaResponse(
      new Request(`grace-booth-media://asset/${collageId}`),
      media,
    );
    expect(assetResponse.status).toBe(200);
    expect(assetResponse.headers.get('content-type')).toBe('image/jpeg');
    expect(assetResponse.headers.get('cache-control')).toBe('no-store, private');
    expect(assetResponse.headers.get('x-content-type-options')).toBe('nosniff');
    expect(Buffer.from(await assetResponse.arrayBuffer())).toEqual(collageBytes);

    const thumbResponse = await readMediaResponse(
      new Request(`grace-booth-media://thumb/${collageId}`),
      media,
    );
    expect(thumbResponse.status).toBe(200);
    expect(thumbResponse.headers.get('content-type')).toBe('image/jpeg');
    expect(thumbResponse.headers.get('cache-control')).toBe('no-store, private');
    expect(thumbResponse.headers.get('x-content-type-options')).toBe('nosniff');
    expect(Buffer.from(await thumbResponse.arrayBuffer())).toEqual(Buffer.from('thumb-bytes'));

    const captureThumbResponse = await readMediaResponse(
      new Request(`grace-booth-media://thumb/${captureId}`),
      media,
    );
    expect(captureThumbResponse.status).toBe(404);

    const badHost = await readMediaResponse(
      new Request(`grace-booth-media://other/${collageId}`),
      media,
    );
    expect(badHost.status).toBe(404);

    const badId = await readMediaResponse(
      new Request('grace-booth-media://thumb/not-a-uuid'),
      media,
    );
    expect(badId.status).toBe(404);
  });
});

async function waitForCondition(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error('Timed out waiting for async test condition');
    }
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

function listAllFiles(directory: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      results.push(...listAllFiles(fullPath));
    } else {
      results.push(fullPath);
    }
  }
  return results;
}
