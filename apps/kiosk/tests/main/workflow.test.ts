import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';

import type {
  BoothSnapshot,
  CameraAdapter,
  CameraStatus,
  CaptureRequest,
  CaptureResult,
  QrStationState,
} from '@grace-booth/shared';
import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { assertOperatorBootstrapComplete } from '../../src/main/auth/bootstrap-guard.js';
import { MockCameraAdapter } from '../../src/main/camera/mock-camera-adapter.js';
import { RendererFrameBroker } from '../../src/main/camera/renderer-frame-broker.js';
import { SonyCameraAdapter } from '../../src/main/camera/sony-camera-adapter.js';
import { WebcamCameraAdapter } from '../../src/main/camera/webcam-camera-adapter.js';
import type { QrService } from '../../src/main/cloud/qr-service.js';
import type { UploadQueue } from '../../src/main/cloud/upload-queue.js';
import type { CapturePolicyOverride } from '../../src/main/config.js';
import { PrintRepository } from '../../src/main/database/print-repository.js';
import type { StoredFrame } from '../../src/main/database/repositories.js';
import type { FrameService } from '../../src/main/frame/frame-service.js';
import type { ImageProcessor } from '../../src/main/image/image-worker-client.js';
import {
  MOCK_PRINTER_NAME,
  MockPrinterAdapter,
} from '../../src/main/print/mock-printer-adapter.js';
import { PrintService, type WorkflowPrintPort } from '../../src/main/print/print-service.js';
import { RetentionService } from '../../src/main/storage/retention-service.js';
import { BoothWorkflow } from '../../src/main/workflow/booth-workflow.js';
import { createTestStore, type TestStore } from './helpers.js';

let store: TestStore | null = null;
let workflow: BoothWorkflow | null = null;
afterEach(async () => {
  await workflow?.close();
  workflow = null;
  store?.close();
  store = null;
});

describe('booth workflow camera recovery', () => {
  it('keeps Attract when advisory startup warm-up fails', async () => {
    ({ store, workflow } = createWorkflow(new SequencedCamera(['throw'])));
    await workflow.initialize();
    expect(workflow.getSnapshot()).toMatchObject({ screen: 'attract', state: null });
  });

  it('routes the honest unsupported Sony adapter directly to calm recovery', async () => {
    ({ store, workflow } = createWorkflow(new SonyCameraAdapter()));
    const snapshot = await workflow.start();
    expect(snapshot).toMatchObject({
      screen: 'recovery',
      state: 'camera_error',
      errorCode: 'capture_failed',
    });
    expect(snapshot.countdownEndsAt).toBeNull();
  });

  it('reconnects before operator restart after an actual Start failure', async () => {
    const camera = new SequencedCamera(['throw', 'ready']);
    ({ store, workflow } = createWorkflow(camera));
    const failed = await workflow.start();
    expect(failed.state).toBe('camera_error');
    const restarted = await workflow.restartSession(failed.sessionId!);
    expect(restarted).toMatchObject({ screen: 'countdown', state: 'countdown', captureCount: 0 });
    expect(camera.connectCalls).toBe(2);
  });

  it('surfaces partial interrupted capture as actionable operator recovery', async () => {
    ({ store, workflow } = createWorkflow(new SequencedCamera(['ready', 'ready'])));
    const session = store.repository.createSession(randomUUID(), 1_000);
    store.database.raw
      .prepare(
        `UPDATE sessions SET state = 'interrupted', capture_count = 1,
          last_error_code = 'app_restarted' WHERE id = ?`,
      )
      .run(session.id);
    await workflow.initialize();
    const recovered = workflow.getSnapshot();
    expect(recovered).toMatchObject({ screen: 'recovery', state: 'camera_error', captureCount: 1 });
    const restarted = await workflow.restartSession(session.id);
    expect(restarted).toMatchObject({ screen: 'countdown', state: 'countdown', captureCount: 0 });
  });

  it('transitions session to upload_failed on auth-required event and supports finishOffline', async () => {
    const queue = new FakeUploadQueue();
    const camera = new SequencedCamera(['ready']);
    const testStore = createTestStore();
    store = testStore;
    queue.testStore = testStore;
    const sessionId = randomUUID();
    testStore.repository.createSession(sessionId, 1_000);
    testStore.database.raw
      .prepare("UPDATE sessions SET state = 'uploading', capture_count = 3 WHERE id = ?")
      .run(sessionId);

    const imageProcessor: ImageProcessor = {
      process: () => Promise.reject(new Error('not used')),
      validateSourceJpeg: () => Promise.reject(new Error('not used')),
      normalizeFramePng: () => Promise.reject(new Error('not used')),
      createThumbnail: () => Promise.reject(new Error('not used')),
      close: () => Promise.resolve(),
    };
    const frameService = {
      ensureDefaultFrame: () => Promise.resolve(undefined),
      ensureDefaultFrames: () => Promise.resolve({ option1: undefined, option2: undefined }),
      getFrameOptions: () => [null, null],
      getFrameSummaries: () => [],
      listFrames: () => [],
      toSummary: (f: StoredFrame) => ({
        id: f.id,
        name: f.name,
        width: 1200,
        height: 3600,
        byteSize: 1000,
        mediaUrl: `grace-booth-media://asset/${f.id}`,
        slots: [],
        revision: 0,
      }),
    } as unknown as FrameService;
    const qrService = {
      render: () => Promise.resolve({ imageDataUrl: 'data:image/png;base64,mockqr' }),
    } as unknown as QrService;

    workflow = new BoothWorkflow(
      testStore.repository,
      testStore.vault,
      camera,
      frameService,
      imageProcessor,
      queue as unknown as UploadQueue,
      qrService,
      {
        captureOverride: { countdownMs: 60_000, reviewMode: 'continuous' },
        isDualDisplayActive: () => false,
        now: () => 2_000,
      },
    );
    await workflow.initialize();

    queue.emit('auth-required', sessionId);
    const snapshot = workflow.getSnapshot();
    expect(snapshot.state).toBe('upload_failed');
    expect(snapshot.controls.canFinishOffline).toBe(true);

    const finished = await workflow.finishOffline();
    expect(finished.state).toBe('final');
  });

  it('accepts the chosen library frame by id and composites with its artwork', async () => {
    const queue = new FakeUploadQueue();
    const camera = new SequencedCamera(['ready']);
    const testStore = createTestStore();
    store = testStore;
    queue.testStore = testStore;

    const frame1Id = randomUUID();
    const frame2Id = randomUUID();

    const mockFrame1 = {
      id: frame1Id,
      name: 'Option 1',
      encryptedPath: 'f1.png',
      width: 1200,
      height: 3600,
      byteSize: 100,
      sha256: 'a'.repeat(64),
      revision: 0,
      createdAt: 1,
      updatedAt: 1,
      sortOrder: 1,
      slots: [],
    };
    const mockFrame2 = {
      ...mockFrame1,
      id: frame2Id,
      name: 'Option 2',
      encryptedPath: 'f2.png',
      sha256: 'b'.repeat(64),
      sortOrder: 2,
    };

    const frameService = {
      ensureDefaultFrame: () => Promise.resolve(mockFrame1),
      ensureDefaultFrames: () => Promise.resolve({ option1: mockFrame1, option2: mockFrame2 }),
      getFrameOptions: () => [mockFrame1, mockFrame2],
      getFrameSummaries: () => [
        { ...mockFrame1, mediaUrl: `grace-booth-media://asset/${frame1Id}` },
        { ...mockFrame2, mediaUrl: `grace-booth-media://asset/${frame2Id}` },
      ],
      listFrames: () => [mockFrame1, mockFrame2],
      toSummary: (f: StoredFrame) => ({
        id: f.id,
        name: f.name,
        width: 1200,
        height: 3600,
        byteSize: 1000,
        mediaUrl: `grace-booth-media://asset/${f.id}`,
        slots: [],
        revision: 0,
      }),
    } as unknown as FrameService;

    const sessionId = randomUUID();
    testStore.repository.createSession(sessionId, 1_000);
    testStore.database.raw
      .prepare("UPDATE sessions SET state = 'review', capture_count = 3 WHERE id = ?")
      .run(sessionId);

    const frame1Vault = testStore.vault.write('frames', Buffer.from('f1'));
    const frame2Vault = testStore.vault.write('frames', Buffer.from('f2'));

    testStore.database.raw
      .prepare(
        `INSERT INTO frames
          (id, name, encrypted_path, width, height, byte_size, sha256, revision, sort_order, created_at, updated_at)
        VALUES (?, 'Option 1', ?, 1200, 3600, 100, ?, 0, 1, 1, 1),
               (?, 'Option 2', ?, 1200, 3600, 100, ?, 0, 2, 1, 1)`,
      )
      .run(
        frame1Id,
        frame1Vault.relativePath,
        'a'.repeat(64),
        frame2Id,
        frame2Vault.relativePath,
        'b'.repeat(64),
      );

    for (const fid of [frame1Id, frame2Id]) {
      for (let s = 1; s <= 3; s++) {
        testStore.database.raw
          .prepare(
            `INSERT INTO frame_slots (frame_id, slot_index, name, x, y, width, height, crop_mode)
            VALUES (?, ?, ?, 0.1, ?, 0.8, 0.2, 'crop-to-fill')`,
          )
          .run(fid, s, `Photo ${s}`, (s - 1) * 0.3);
      }
    }

    for (let i = 1; i <= 3; i++) {
      const written = testStore.vault.write('pending', Buffer.from(`photo-${i}`));
      testStore.database.raw
        .prepare(
          `INSERT INTO session_assets
            (id, session_id, kind, retake_round, shot_number, encrypted_path, content_type, width, height, byte_size, sha256, created_at)
          VALUES (?, ?, 'capture', 0, ?, ?, 'image/jpeg', 1000, 1000, 100, ?, 1)`,
        )
        .run(randomUUID(), sessionId, i, written.relativePath, `${i}`.repeat(64));
    }

    let processedFramePng: Buffer | null = null;
    let processedCaptureCount = 0;
    let processInputKeys: string[] = [];
    const imageProcessor: ImageProcessor = {
      process: (input) => {
        const { captures, framePng } = input;
        processedFramePng = Buffer.isBuffer(framePng) ? framePng : Buffer.from(framePng);
        processedCaptureCount = captures.length;
        processInputKeys = Object.keys(input);
        return Promise.resolve({
          bytes: Buffer.from('collage-jpeg'),
          width: 1200,
          height: 3600,
          byteSize: 12,
          timing: {
            validationMs: 1,
            slotsMs: 1,
            compositeMs: 1,
            totalMs: 3,
          },
        });
      },
      validateSourceJpeg: () => Promise.resolve({ width: 1000, height: 1000 }),
      normalizeFramePng: () => Promise.reject(new Error('not used')),
      createThumbnail: () => Promise.reject(new Error('not used')),
      close: () => Promise.resolve(),
    };

    const qrService = {
      render: () => Promise.resolve({ imageDataUrl: 'data:image/png;base64,mockqr' }),
    } as unknown as QrService;

    workflow = new BoothWorkflow(
      testStore.repository,
      testStore.vault,
      camera,
      frameService,
      imageProcessor,
      queue as unknown as UploadQueue,
      qrService,
      {
        captureOverride: { countdownMs: 60_000, reviewMode: 'continuous' },
        isDualDisplayActive: () => false,
        now: () => 2_000,
      },
    );
    await workflow.initialize();

    // Accept photos with the second library frame selected by id.
    const snapshot = workflow.acceptPhotos(frame2Id);
    expect(snapshot.state).toBe('processing');

    const updatedSession = testStore.repository.getSession(sessionId);
    expect(updatedSession?.selectedFrameId).toBe(frame2Id);
    expect(processedFramePng).toBeDefined();
    expect(processedCaptureCount).toBe(3);
    expect(processInputKeys).toEqual(['captures', 'framePng', 'slots', 'frameAspectRatio']);
  });
});

describe('per-shot capture review and continuous mode', () => {
  const capturingProcessor: ImageProcessor = {
    process: () => Promise.reject(new Error('not used')),
    validateSourceJpeg: () => Promise.resolve({ width: 1_000, height: 1_000 }),
    normalizeFramePng: () => Promise.reject(new Error('not used')),
    createThumbnail: () => Promise.reject(new Error('not used')),
    close: () => Promise.resolve(),
  };

  function seedActiveFrame(testStore: TestStore, slotCount: number): string {
    const frameId = randomUUID();
    const frameVault = testStore.vault.write('frames', Buffer.from(`frame-${slotCount}`));
    testStore.repository.addFrame(
      {
        id: frameId,
        name: `${slotCount}-Slot Frame`,
        encryptedPath: frameVault.relativePath,
        width: 1_800,
        height: 1_200,
        byteSize: frameVault.byteSize,
        sha256: frameVault.sha256,
        revision: 0,
        sortOrder: 1,
        archived: false,
        createdAt: 1,
        updatedAt: 1,
      },
      Array.from({ length: slotCount }, (_, index) => ({
        slotIndex: index + 1,
        zIndex: index,
        name: `Photo ${index + 1}`,
        x: 0.05,
        y: 0.05,
        width: 0.4,
        height: 0.4,
        cropMode: 'crop-to-fill' as const,
      })),
    );
    return frameId;
  }

  it('pauses for guest confirmation after every capture on a 4-slot frame with uniform 8s countdowns and non-destructive single-shot retakes', async () => {
    vi.useFakeTimers();
    try {
      let clock = 1_000;
      const camera = new BufferCamera();
      ({ store, workflow } = createWorkflow(camera, {
        now: () => clock,
        imageProcessor: capturingProcessor,
      }));
      seedActiveFrame(store, 4);
      await workflow.initialize();

      const started = await workflow.start();
      expect(started).toMatchObject({
        screen: 'countdown',
        state: 'countdown',
        shotNumber: 1,
        captureCount: 0,
        requiredShotCount: 4,
        countdownEndsAt: 9_000,
        countdownTotalSeconds: 8,
        controls: { canAcceptShot: false, canRetakeShot: false },
      });

      clock += 8_000;
      await vi.advanceTimersByTimeAsync(8_000);
      const afterShot1 = workflow.getSnapshot();
      expect(afterShot1).toMatchObject({
        screen: 'shot_review',
        state: 'shot_review',
        shotNumber: 1,
        captureCount: 0,
        requiredShotCount: 4,
        countdownEndsAt: null,
        countdownTotalSeconds: null,
        controls: { canAcceptShot: true, canRetakeShot: true },
      });
      expect(afterShot1.media.captureUrls).toHaveLength(1);
      const slot1Url = afterShot1.media.captureUrls[0]!;

      await vi.advanceTimersByTimeAsync(30_000);
      expect(camera.captures).toBe(1);
      expect(workflow.getSnapshot().state).toBe('shot_review');

      clock += 1_000;
      const afterAccept1 = await workflow.acceptShot(1);
      expect(afterAccept1).toMatchObject({
        screen: 'countdown',
        state: 'countdown',
        shotNumber: 2,
        captureCount: 1,
        countdownEndsAt: clock + 8_000,
        countdownTotalSeconds: 8,
      });
      expect(afterAccept1.media.captureUrls).toEqual([slot1Url]);

      clock += 8_000;
      await vi.advanceTimersByTimeAsync(8_000);
      const shot2Attempt1 = workflow.getSnapshot();
      expect(shot2Attempt1).toMatchObject({
        screen: 'shot_review',
        state: 'shot_review',
        shotNumber: 2,
        captureCount: 1,
      });
      expect(shot2Attempt1.media.captureUrls).toHaveLength(2);
      expect(shot2Attempt1.media.captureUrls[0]).toBe(slot1Url);
      const slot2Attempt1Url = shot2Attempt1.media.captureUrls[1]!;

      const retakingSlot2First = await workflow.retakeShot(2);
      expect(retakingSlot2First).toMatchObject({
        screen: 'countdown',
        state: 'countdown',
        shotNumber: 2,
        captureCount: 1,
        countdownTotalSeconds: 8,
      });
      expect(retakingSlot2First.media.captureUrls).toEqual([slot1Url]);

      clock += 8_000;
      await vi.advanceTimersByTimeAsync(8_000);
      const shot2Attempt2 = workflow.getSnapshot();
      expect(shot2Attempt2.media.captureUrls[0]).toBe(slot1Url);
      expect(shot2Attempt2.media.captureUrls[1]).not.toBe(slot2Attempt1Url);

      await workflow.retakeShot(2);
      clock += 8_000;
      await vi.advanceTimersByTimeAsync(8_000);
      const shot2Attempt3 = workflow.getSnapshot();
      expect(shot2Attempt3.media.captureUrls[0]).toBe(slot1Url);
      const slot2WinningUrl = shot2Attempt3.media.captureUrls[1]!;
      expect(slot2WinningUrl).not.toBe(slot2Attempt1Url);
      expect(store.repository.listAssets(started.sessionId!)).toHaveLength(4);

      await workflow.acceptShot(2);
      clock += 8_000;
      await vi.advanceTimersByTimeAsync(8_000);
      expect(workflow.getSnapshot()).toMatchObject({
        screen: 'shot_review',
        shotNumber: 3,
        captureCount: 2,
      });
      await workflow.acceptShot(3);

      clock += 8_000;
      await vi.advanceTimersByTimeAsync(8_000);
      const shot4Attempt1 = workflow.getSnapshot();
      expect(shot4Attempt1).toMatchObject({
        screen: 'shot_review',
        shotNumber: 4,
        captureCount: 3,
      });
      const slot4FirstUrl = shot4Attempt1.media.captureUrls[3]!;

      await workflow.retakeShot(4);
      clock += 8_000;
      await vi.advanceTimersByTimeAsync(8_000);
      const shot4Attempt2 = workflow.getSnapshot();
      expect(shot4Attempt2.media.captureUrls[3]).not.toBe(slot4FirstUrl);

      const finalReview = await workflow.acceptShot(4);
      expect(finalReview).toMatchObject({
        screen: 'review',
        state: 'review',
        shotNumber: null,
        captureCount: 4,
        requiredShotCount: 4,
        countdownEndsAt: null,
        countdownTotalSeconds: null,
        controls: {
          canAcceptShot: false,
          canRetakeShot: false,
          canAcceptPhotos: true,
          canRetakeAll: true,
        },
      });
      expect(finalReview.media.captureUrls).toHaveLength(4);
      expect(finalReview.media.captureUrls[0]).toBe(slot1Url);
      expect(finalReview.media.captureUrls[1]).toBe(slot2WinningUrl);
      expect(finalReview.media.captureUrls[3]).toBe(shot4Attempt2.media.captureUrls[3]);
      expect(camera.captures).toBe(7);
      expect(store.repository.listAssets(started.sessionId!)).toHaveLength(7);
    } finally {
      vi.useRealTimers();
    }
  });

  it('handles duplicate acceptShot and retakeShot taps idempotently including concurrent reconnects', async () => {
    vi.useFakeTimers();
    try {
      let releaseConnect: (() => void) | null = null;
      let connectCount = 0;
      const camera: CameraAdapter = {
        connect: () => {
          connectCount += 1;
          if (connectCount === 1 || connectCount === 2) {
            return Promise.resolve(readyStatus());
          }
          return new Promise<CameraStatus>((resolve) => {
            releaseConnect = () => resolve(readyStatus());
          });
        },
        getStatus: () => Promise.resolve(readyStatus()),
        capture: (request) =>
          Promise.resolve({
            kind: 'buffer',
            captureId: request.captureId,
            bytes: Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x01, 0x02]),
            contentType: 'image/jpeg',
            capturedAt: 1,
          }),
        disconnect: () => Promise.resolve(),
      };
      ({ store, workflow } = createWorkflow(camera, {
        now: () => 5_000,
        imageProcessor: capturingProcessor,
      }));
      seedActiveFrame(store, 2);
      await workflow.initialize();

      await workflow.start();
      await vi.advanceTimersByTimeAsync(8_000);
      expect(workflow.getSnapshot().state).toBe('shot_review');

      await expect(workflow.acceptShot(2)).rejects.toThrow();

      const firstRetake = workflow.retakeShot(1);
      const duplicateRetake = workflow.retakeShot(1);
      expect((await duplicateRetake).state).toBe('countdown');
      releaseConnect!();
      const settledRetake = await firstRetake;
      expect(settledRetake).toMatchObject({ state: 'countdown', shotNumber: 1, captureCount: 0 });
      const timerDeadline = settledRetake.countdownEndsAt;
      expect((await workflow.retakeShot(1)).countdownEndsAt).toBe(timerDeadline);

      await vi.advanceTimersByTimeAsync(8_000);
      const firstAccept = workflow.acceptShot(1);
      const duplicateAccept = workflow.acceptShot(1);
      expect((await duplicateAccept).captureCount).toBe(1);
      releaseConnect!();
      const settledAccept = await firstAccept;
      expect(settledAccept).toMatchObject({ state: 'countdown', shotNumber: 2, captureCount: 1 });
      expect((await workflow.acceptShot(1)).captureCount).toBe(1);

      await vi.advanceTimersByTimeAsync(8_000);
      const reviewSnap = await workflow.acceptShot(2);
      expect(reviewSnap.state).toBe('review');
      expect((await workflow.acceptShot(2)).state).toBe('review');
    } finally {
      vi.useRealTimers();
    }
  });

  it('preserves shot_review across restart, reconnects camera on guest action, and guards cancel during reconnect', async () => {
    vi.useFakeTimers();
    try {
      const initialCamera = new BufferCamera();
      ({ store, workflow } = createWorkflow(initialCamera, {
        now: () => 1_000,
        imageProcessor: capturingProcessor,
      }));
      seedActiveFrame(store, 2);
      await workflow.initialize();

      const started = await workflow.start();
      await vi.advanceTimersByTimeAsync(8_000);
      expect(workflow.getSnapshot().state).toBe('shot_review');
      await workflow.close();
      workflow = null;

      const retention = new RetentionService(
        store.repository,
        store.vault,
        store.secrets,
        store.paths,
      );
      expect(retention.recoverAfterRestart(2_000)).toEqual({
        interrupted: 0,
        missingAssets: 0,
        corruptAssets: 0,
      });
      expect(store.repository.requireSession(started.sessionId!).state).toBe('shot_review');

      let releaseReconnect: (() => void) | null = null;
      let reconnectCalls = 0;
      const reconnectingCamera: CameraAdapter = {
        connect: () => {
          reconnectCalls += 1;
          if (reconnectCalls === 1) return Promise.reject(new Error('camera still booting'));
          return new Promise<CameraStatus>((resolve) => {
            releaseReconnect = () => resolve(readyStatus());
          });
        },
        getStatus: () => Promise.resolve(readyStatus()),
        capture: (request) =>
          Promise.resolve({
            kind: 'buffer',
            captureId: request.captureId,
            bytes: Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x01, 0x02]),
            contentType: 'image/jpeg',
            capturedAt: 1,
          }),
        disconnect: () => Promise.resolve(),
      };

      const queue = new FakeUploadQueue();
      const frameService = {
        ensureDefaultFrame: () => Promise.resolve(undefined),
        ensureDefaultFrames: () => Promise.resolve({ option1: undefined, option2: undefined }),
        getFrameOptions: () => [null, null],
        getFrameSummaries: () => [],
        listFrames: () => [],
        toSummary: (f: StoredFrame) => ({
          id: f.id,
          name: f.name,
          width: f.width,
          height: f.height,
          byteSize: f.byteSize,
          mediaUrl: `grace-booth-media://asset/${f.id}`,
          slots: f.slots,
          revision: f.revision,
        }),
      } as unknown as FrameService;
      const qrService = {
        render: () => Promise.resolve({ imageDataUrl: 'data:image/png;base64,mockqr' }),
      } as unknown as QrService;

      workflow = new BoothWorkflow(
        store.repository,
        store.vault,
        reconnectingCamera,
        frameService,
        capturingProcessor,
        queue as unknown as UploadQueue,
        qrService,
        { isDualDisplayActive: () => false, now: () => 2_000 },
      );
      await workflow.initialize();
      expect(workflow.getSnapshot()).toMatchObject({
        screen: 'shot_review',
        state: 'shot_review',
        shotNumber: 1,
        captureCount: 0,
        controls: { canAcceptShot: true, canRetakeShot: true },
      });

      const acceptPromise = workflow.acceptShot(1);
      expect(reconnectCalls).toBe(2);

      const cancelled = workflow.cancelSession();
      expect(cancelled.screen).toBe('attract');
      releaseReconnect!();
      const afterAccept = await acceptPromise;
      expect(afterAccept.screen).toBe('attract');

      await vi.advanceTimersByTimeAsync(15_000);
      expect(workflow.getSnapshot().screen).toBe('attract');
    } finally {
      vi.useRealTimers();
    }
  });

  it('routes interrupted sessions with local_asset_unavailable to camera_error even when all shots were recorded', async () => {
    ({ store, workflow } = createWorkflow(new SequencedCamera(['ready']), {
      imageProcessor: capturingProcessor,
    }));
    const session = store.repository.createSession(randomUUID(), 1_000, null, 2, {
      countdownSeconds: 8,
      reviewMode: 'continuous',
    });
    for (let shot = 1; shot <= 2; shot += 1) {
      const written = store.vault.write('pending', Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
      store.database.raw
        .prepare(
          `INSERT INTO session_assets
            (id, session_id, kind, retake_round, shot_number, shot_attempt, encrypted_path,
              content_type, width, height, byte_size, sha256, created_at)
          VALUES (?, ?, 'capture', 0, ?, 1, ?, 'image/jpeg', 100, 100, ?, ?, 1)`,
        )
        .run(
          randomUUID(),
          session.id,
          shot,
          written.relativePath,
          written.byteSize,
          written.sha256,
        );
    }
    store.database.raw
      .prepare(
        `UPDATE sessions SET state = 'interrupted', capture_count = 2,
          last_error_code = 'local_asset_unavailable',
          last_error_message = 'A local photo could not be verified.' WHERE id = ?`,
      )
      .run(session.id);

    await workflow.initialize();
    expect(workflow.getSnapshot()).toMatchObject({
      screen: 'recovery',
      state: 'camera_error',
      errorCode: 'capture_failed',
    });
    expect(store.repository.requireSession(session.id).lastErrorCode).toBe(
      'local_asset_unavailable',
    );
  });

  it('applies admin capture setting changes to new sessions while locking active sessions', async () => {
    vi.useFakeTimers();
    try {
      const clock = 10_000;
      const camera = new BufferCamera();
      ({ store, workflow } = createWorkflow(camera, {
        now: () => clock,
        imageProcessor: capturingProcessor,
      }));
      await workflow.initialize();

      const first = await workflow.start();
      expect(first.countdownEndsAt).toBe(18_000);
      expect(first.countdownTotalSeconds).toBe(8);

      const currentSettings = store.repository.getSettings();
      store.repository.setCaptureSettings({
        countdownSeconds: 5,
        reviewMode: 'continuous',
        expectedRevision: currentSettings.revision,
      });

      await vi.advanceTimersByTimeAsync(8_000);
      expect(workflow.getSnapshot().state).toBe('shot_review');
      const nextShotInFirst = await workflow.acceptShot(1);
      expect(nextShotInFirst.countdownEndsAt).toBe(18_000);
      expect(nextShotInFirst.countdownTotalSeconds).toBe(8);

      workflow.cancelSession();

      const second = await workflow.start();
      expect(second.countdownEndsAt).toBe(15_000);
      expect(second.countdownTotalSeconds).toBe(5);

      await vi.advanceTimersByTimeAsync(5_000);
      expect(store.repository.requireSession(second.sessionId!)).toMatchObject({
        state: 'countdown',
        captureCount: 1,
      });
      expect(workflow.getSnapshot().countdownEndsAt).toBe(15_000);

      await vi.advanceTimersByTimeAsync(5_000);
      await vi.advanceTimersByTimeAsync(5_000);
      expect(store.repository.requireSession(second.sessionId!)).toMatchObject({
        state: 'review',
        captureCount: 3,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('re-emits idle attract snapshots on refreshIdleSnapshot without disturbing active sessions', async () => {
    const camera = new BufferCamera();
    ({ store, workflow } = createWorkflow(camera, { imageProcessor: capturingProcessor }));
    await workflow.initialize();

    const emitted: { screen: string; requiredShotCount?: number }[] = [];
    workflow.subscribe((snap) =>
      emitted.push({
        screen: snap.screen,
        ...(snap.requiredShotCount === undefined
          ? {}
          : { requiredShotCount: snap.requiredShotCount }),
      }),
    );

    seedActiveFrame(store, 4);
    workflow.refreshIdleSnapshot();
    expect(emitted).toEqual([{ screen: 'attract', requiredShotCount: 4 }]);

    emitted.length = 0;
    await workflow.start();
    const afterStartCount = emitted.length;
    workflow.refreshIdleSnapshot();
    expect(emitted).toHaveLength(afterStartCount);
  });

  it('collapses every shot window in continuous mode when captureOverride supplies countdownMs', async () => {
    vi.useFakeTimers();
    try {
      const camera = new BufferCamera();
      ({ store, workflow } = createWorkflow(camera, {
        captureOverride: { countdownMs: 40, reviewMode: 'continuous' },
        imageProcessor: capturingProcessor,
      }));
      await workflow.initialize();

      const started = await workflow.start();
      expect(started.countdownEndsAt).toBe(2_040);
      expect(started.countdownTotalSeconds).toBe(1);
      await vi.advanceTimersByTimeAsync(40);
      expect(store.repository.requireSession(started.sessionId!).captureCount).toBe(1);
      expect(workflow.getSnapshot().countdownEndsAt).toBe(2_040);
    } finally {
      vi.useRealTimers();
    }
  });

  it('wraps MockCameraAdapter fixture reads cleanly across slots 1 through 10', async () => {
    const adapter = new MockCameraAdapter({
      fixtureDirectory: fileURLToPath(new URL('../../resources/mock', import.meta.url)),
      delayMs: 0,
    });
    await adapter.connect();
    try {
      const sessionId = randomUUID();
      for (let shotNumber = 1; shotNumber <= 10; shotNumber += 1) {
        const result = await adapter.capture({
          sessionId,
          captureId: randomUUID(),
          shotNumber,
          timeoutMs: 5_000,
        });
        expect(result.kind).toBe('buffer');
        if (result.kind === 'buffer') {
          expect(result.bytes.byteLength).toBeGreaterThan(100);
        }
      }
    } finally {
      await adapter.disconnect();
    }
  });
});

describe('guest session cancellation', () => {
  const capturingProcessor: ImageProcessor = {
    process: () => Promise.reject(new Error('not used')),
    validateSourceJpeg: () => Promise.resolve({ width: 1_000, height: 1_000 }),
    normalizeFramePng: () => Promise.reject(new Error('not used')),
    createThumbnail: () => Promise.reject(new Error('not used')),
    close: () => Promise.resolve(),
  };

  function createCapturingWorkflow(reviewMode: 'per_shot' | 'continuous' = 'continuous') {
    return createWorkflow(new BufferCamera(), {
      captureOverride: { countdownMs: 60_000, reviewMode },
      imageProcessor: capturingProcessor,
    });
  }

  it('cancel during countdown deletes created assets and vault files and reaches attract', async () => {
    vi.useFakeTimers();
    try {
      const created = createCapturingWorkflow('continuous');
      store = created.store;
      const testStore = created.store;
      const activeWorkflow = (workflow = created.workflow);
      await activeWorkflow.initialize();
      const started = await activeWorkflow.start();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(testStore.repository.requireSession(started.sessionId!).captureCount).toBe(1);

      const [asset] = testStore.repository.listAssets(started.sessionId!);
      expect(asset).toBeDefined();
      const encryptedPath = asset!.encryptedPath;
      expect(() => testStore.vault.read(encryptedPath)).not.toThrow();

      const cancelled = activeWorkflow.cancelSession();
      expect(cancelled).toMatchObject({ screen: 'attract', state: null, sessionId: null });
      expect(testStore.repository.getSession(started.sessionId!)).toBeNull();
      expect(testStore.repository.listAssets(started.sessionId!)).toHaveLength(0);
      expect(() => testStore.vault.read(encryptedPath)).toThrow();
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancel during shot_review purges all capture attempts including superseded retakes', async () => {
    vi.useFakeTimers();
    try {
      const created = createCapturingWorkflow('per_shot');
      store = created.store;
      const testStore = created.store;
      const activeWorkflow = (workflow = created.workflow);
      await activeWorkflow.initialize();

      const started = await activeWorkflow.start();
      await vi.advanceTimersByTimeAsync(60_000);
      await activeWorkflow.retakeShot(1);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(activeWorkflow.getSnapshot().state).toBe('shot_review');

      const assets = testStore.repository.listAssets(started.sessionId!);
      expect(assets).toHaveLength(2);

      const cancelled = activeWorkflow.cancelSession();
      expect(cancelled).toMatchObject({ screen: 'attract', state: null, sessionId: null });
      expect(testStore.repository.getSession(started.sessionId!)).toBeNull();
      for (const asset of assets) {
        expect(() => testStore.vault.read(asset.encryptedPath)).toThrow();
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it('purges only the partial captures; a later session is unaffected', async () => {
    vi.useFakeTimers();
    try {
      const created = createCapturingWorkflow('continuous');
      store = created.store;
      const activeWorkflow = (workflow = created.workflow);
      await activeWorkflow.initialize();
      const first = await activeWorkflow.start();
      await vi.advanceTimersByTimeAsync(60_000);
      activeWorkflow.cancelSession();

      const second = await activeWorkflow.start();
      for (let shot = 0; shot < 3; shot += 1) {
        await vi.advanceTimersByTimeAsync(60_000);
      }
      const finished = store.repository.requireSession(second.sessionId!);
      expect(finished.state).toBe('review');
      expect(finished.captureCount).toBe(3);

      const remaining = store.database.raw.prepare('SELECT COUNT(*) AS n FROM sessions').get() as {
        n: number;
      };
      expect(remaining.n).toBe(1);
      expect(
        store.database.raw
          .prepare('SELECT COUNT(*) AS n FROM session_assets WHERE session_id = ?')
          .get(first.sessionId!) as { n: number },
      ).toMatchObject({ n: 0 });
    } finally {
      vi.useRealTimers();
    }
  });

  it('is idempotent and never deletes a session outside cancellable states', async () => {
    vi.useFakeTimers();
    try {
      const created = createCapturingWorkflow('continuous');
      store = created.store;
      const activeWorkflow = (workflow = created.workflow);
      await activeWorkflow.initialize();

      expect(() => activeWorkflow.cancelSession()).not.toThrow();
      expect(activeWorkflow.cancelSession()).toMatchObject({ screen: 'attract', state: null });

      const started = await activeWorkflow.start();
      await vi.advanceTimersByTimeAsync(60_000);
      store.database.raw
        .prepare("UPDATE sessions SET state = 'final' WHERE id = ?")
        .run(started.sessionId!);

      const result = activeWorkflow.cancelSession();
      expect(result.state).toBe('final');
      expect(store.repository.getSession(started.sessionId!)).not.toBeNull();

      expect(() => activeWorkflow.cancelSession()).not.toThrow();
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancels during an unresolved in-flight frame request and allows immediate next session', async () => {
    vi.useFakeTimers();
    try {
      const broker = new RendererFrameBroker();
      let lastFrameRequest: { captureId: string } | null = null;
      broker.attach((req) => {
        lastFrameRequest = req;
      });
      const camera = new WebcamCameraAdapter(broker);
      const created = createWorkflow(camera, {
        captureOverride: { countdownMs: 1_000, reviewMode: 'continuous' },
        imageProcessor: capturingProcessor,
      });
      store = created.store;
      const activeWorkflow = (workflow = created.workflow);
      await activeWorkflow.initialize();

      const first = await activeWorkflow.start();
      expect(first.state).toBe('countdown');

      await vi.advanceTimersByTimeAsync(1_000);
      expect(lastFrameRequest).not.toBeNull();

      const cancelled = activeWorkflow.cancelSession();
      expect(cancelled.screen).toBe('attract');

      const second = await activeWorkflow.start();
      expect(second.state).toBe('countdown');
      lastFrameRequest = null;
      await vi.advanceTimersByTimeAsync(1_000);
      expect(lastFrameRequest).not.toBeNull();

      const validJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x01, 0x02]);
      broker.submitFrame(lastFrameRequest!.captureId, validJpeg);
      await vi.advanceTimersByTimeAsync(0);
      expect(store.repository.requireSession(second.sessionId!).captureCount).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('dual display handoff', () => {
  it('resets Screen 1 immediately to attract after acceptPhotos and delivers QR on QR station', async () => {
    const queue = new FakeUploadQueue();
    const camera = new BufferCamera();
    const testStore = createTestStore();
    store = testStore;
    queue.testStore = testStore;

    const frameService = {
      ensureDefaultFrame: () => Promise.resolve(undefined),
      ensureDefaultFrames: () => Promise.resolve({ option1: undefined, option2: undefined }),
      getFrameOptions: () => [null, null],
      getFrameSummaries: () => [
        {
          id: '22222222-2222-4222-8222-222222222222',
          name: 'Default Frame',
          width: 1200,
          height: 3600,
          byteSize: 1000,
          mediaUrl: 'grace-booth-media://asset/test',
          slots: [],
          revision: 0,
        },
      ],
      listFrames: () => [],
      toSummary: (f: StoredFrame) => ({
        id: f.id,
        name: f.name,
        width: 1200,
        height: 3600,
        byteSize: 1000,
        mediaUrl: 'grace-booth-media://asset/test',
        slots: [],
        revision: 0,
      }),
    } as unknown as FrameService;

    const imageProcessor: ImageProcessor = {
      process: () =>
        Promise.resolve({
          bytes: Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x01, 0x02]),
          width: 1200,
          height: 3600,
          byteSize: 6,
          timing: {
            validationMs: 1,
            slotsMs: 1,
            compositeMs: 1,
            totalMs: 5,
          },
        }),
      validateSourceJpeg: () => Promise.resolve({ width: 100, height: 100 }),
      normalizeFramePng: () =>
        Promise.resolve({ bytes: Buffer.from([]), width: 1200, height: 3600 }),
      createThumbnail: () => Promise.resolve({ bytes: Buffer.from([]), width: 300, height: 900 }),
      close: () => Promise.resolve(),
    };

    const qrService = {
      render: () => Promise.resolve({ imageDataUrl: 'data:image/png;base64,mockqr' }),
    } as unknown as QrService;

    workflow = new BoothWorkflow(
      testStore.repository,
      testStore.vault,
      camera,
      frameService,
      imageProcessor,
      queue as unknown as UploadQueue,
      qrService,
      {
        captureOverride: { countdownMs: 0, reviewMode: 'continuous' },
        now: () => 1_000,
        isDualDisplayActive: () => true,
      },
    );

    await workflow.initialize();
    testStore.repository.setDualDisplaySettings('enabled', false, 45);

    // Initial state is attract
    expect(workflow.getSnapshot()).toMatchObject({ screen: 'attract', state: null });
    expect(workflow.getQrStationState()).toMatchObject({ status: 'idle' });

    // Start session and complete 3 captures
    const startSnap = await workflow.start();
    const sessionId = startSnap.sessionId!;

    // Directly put session into review state with 3 captures
    testStore.database.raw
      .prepare(
        "UPDATE sessions SET state = 'review', capture_count = 3, selected_frame_id = '22222222-2222-4222-8222-222222222222' WHERE id = ?",
      )
      .run(sessionId);

    testStore.repository.addFrame(
      {
        id: '22222222-2222-4222-8222-222222222222',
        name: 'Default Frame',
        width: 1200,
        height: 3600,
        byteSize: 1000,
        encryptedPath: 'test',
        sha256: 'a'.repeat(64),
        sortOrder: 0,
        revision: 0,
        archived: false,
        createdAt: 1000,
        updatedAt: 1000,
      },
      [
        {
          slotIndex: 1,
          zIndex: 0,
          name: 'Photo 1',
          x: 0.1,
          y: 0.1,
          width: 0.8,
          height: 0.25,
          cropMode: 'crop-to-fill',
        },
        {
          slotIndex: 2,
          zIndex: 1,
          name: 'Photo 2',
          x: 0.1,
          y: 0.4,
          width: 0.8,
          height: 0.25,
          cropMode: 'crop-to-fill',
        },
        {
          slotIndex: 3,
          zIndex: 2,
          name: 'Photo 3',
          x: 0.1,
          y: 0.7,
          width: 0.8,
          height: 0.25,
          cropMode: 'crop-to-fill',
        },
      ],
    );

    // Accept photos
    const afterAccept = workflow.acceptPhotos('22222222-2222-4222-8222-222222222222');

    // Screen 1 is IMMEDIATELY reset to attract
    expect(afterAccept.screen).toBe('attract');
    expect(afterAccept.state).toBeNull();
    expect(workflow.getSnapshot().screen).toBe('attract');

    // Simulate completion of offline/upload queue for this background session
    await queue.completeOffline(sessionId);

    // Screen 2 now receives active QR station state!
    const qrState = workflow.getQrStationState();
    expect(qrState.status).toBe('active');
    expect(qrState.sessionId).toBe(sessionId);
    expect(qrState.qrImageUrl).toBe('data:image/png;base64,mockqr');
    expect(qrState.durationSeconds).toBe(45);

    // Guest on Screen 2 dismisses
    const dismissed = workflow.dismissQrStation();
    expect(dismissed.status).toBe('idle');
    expect(workflow.getQrStationState().status).toBe('idle');
  });

  it('immediately presents the newest session and rejects stale results and dismissals', async () => {
    const queue = new FakeUploadQueue();
    const camera = new SequencedCamera(['ready']);
    const testStore = createTestStore();
    store = testStore;
    queue.testStore = testStore;

    const imageProcessor: ImageProcessor = {
      process: () => Promise.reject(new Error('not used')),
      validateSourceJpeg: () => Promise.reject(new Error('not used')),
      normalizeFramePng: () => Promise.reject(new Error('not used')),
      createThumbnail: () => Promise.reject(new Error('not used')),
      close: () => Promise.resolve(),
    };
    const frameService = {
      ensureDefaultFrame: () => Promise.resolve(undefined),
      ensureDefaultFrames: () => Promise.resolve({ option1: undefined, option2: undefined }),
      getFrameOptions: () => [null, null],
      getFrameSummaries: () => [],
      listFrames: () => [],
    } as unknown as FrameService;
    const qrService = {
      render: () => Promise.resolve({ imageDataUrl: 'data:image/png;base64,mockqr' }),
    } as unknown as QrService;

    let currentTime = 10_000;
    workflow = new BoothWorkflow(
      testStore.repository,
      testStore.vault,
      camera,
      frameService,
      imageProcessor,
      queue as unknown as UploadQueue,
      qrService,
      {
        captureOverride: { countdownMs: 0, reviewMode: 'continuous' },
        now: () => currentTime,
        isDualDisplayActive: () => true,
      },
    );

    await workflow.initialize();
    testStore.repository.setDualDisplaySettings('enabled', false, 45);

    const session1 = testStore.repository.createSession(randomUUID(), currentTime);
    currentTime += 1;
    const session2 = testStore.repository.createSession(randomUUID(), currentTime);

    // 1. First session finishes upload: presented immediately
    await queue.completeOffline(session1.id);
    let qrState = workflow.getQrStationState();
    expect(qrState.status).toBe('active');
    expect(qrState.sessionId).toBe(session1.id);
    expect(qrState.expiresAt).toBe(currentTime + 45_000);

    // A newer session replaces the current result immediately with a fresh timer.
    currentTime = 20_000;
    await queue.completeOffline(session2.id);
    qrState = workflow.getQrStationState();
    expect(qrState.status).toBe('active');
    expect(qrState.sessionId).toBe(session2.id);
    expect(qrState.expiresAt).toBe(currentTime + 45_000);

    // A late duplicate result from the older session cannot replace the newer one.
    await queue.completeOffline(session1.id);
    qrState = workflow.getQrStationState();
    expect(qrState.status).toBe('active');
    expect(qrState.sessionId).toBe(session2.id);

    // A newer terminal failure replaces the successful result and receives the same timer.
    currentTime += 1;
    const session3 = testStore.repository.createSession(randomUUID(), currentTime);
    const collageId = randomUUID();
    testStore.database.raw
      .prepare(
        `INSERT INTO session_assets
          (id, session_id, kind, retake_round, shot_number, encrypted_path, content_type,
            width, height, byte_size, sha256, created_at)
        VALUES (?, ?, 'collage', 0, NULL, ?, 'image/jpeg', 1200, 3600, 10, ?, ?)`,
      )
      .run(collageId, session3.id, `collages/${collageId}.gbv`, 'd'.repeat(64), currentTime);
    testStore.database.raw
      .prepare("UPDATE sessions SET state = 'pending_upload', collage_asset_id = ? WHERE id = ?")
      .run(collageId, session3.id);
    queue.emit('failed', session3.id);
    qrState = workflow.getQrStationState();
    expect(qrState.status).toBe('error');
    expect(qrState.sessionId).toBe(session3.id);
    expect(qrState.expiresAt).toBe(currentTime + 45_000);

    // A stale Done action is ignored.
    workflow.dismissQrStation(session1.id);
    expect(workflow.getQrStationState().sessionId).toBe(session3.id);

    // Dismissing the displayed session returns the station to idle.
    const finalDismiss = workflow.dismissQrStation(session3.id);
    expect(finalDismiss.status).toBe('idle');
    expect(finalDismiss.sessionId).toBeNull();
  });

  it('restarts the authoritative timer on replacement and then returns to idle', async () => {
    vi.useFakeTimers();
    try {
      const queue = new FakeUploadQueue();
      const camera = new SequencedCamera(['ready']);
      const testStore = createTestStore();
      store = testStore;
      queue.testStore = testStore;

      const imageProcessor: ImageProcessor = {
        process: () => Promise.reject(new Error('not used')),
        validateSourceJpeg: () => Promise.reject(new Error('not used')),
        normalizeFramePng: () => Promise.reject(new Error('not used')),
        createThumbnail: () => Promise.reject(new Error('not used')),
        close: () => Promise.resolve(),
      };
      const frameService = {
        ensureDefaultFrame: () => Promise.resolve(undefined),
        ensureDefaultFrames: () => Promise.resolve({ option1: undefined, option2: undefined }),
        getFrameOptions: () => [null, null],
        getFrameSummaries: () => [],
        listFrames: () => [],
      } as unknown as FrameService;
      const qrService = {
        render: () => Promise.resolve({ imageDataUrl: 'data:image/png;base64,mockqr' }),
      } as unknown as QrService;

      workflow = new BoothWorkflow(
        testStore.repository,
        testStore.vault,
        camera,
        frameService,
        imageProcessor,
        queue as unknown as UploadQueue,
        qrService,
        {
          captureOverride: { countdownMs: 0, reviewMode: 'continuous' },
          isDualDisplayActive: () => true,
        },
      );

      await workflow.initialize();
      testStore.repository.setDualDisplaySettings('enabled', false, 45);

      const s1 = testStore.repository.createSession(randomUUID(), Date.now());
      const s2 = testStore.repository.createSession(randomUUID(), Date.now() + 1);

      await queue.completeOffline(s1.id);
      vi.advanceTimersByTime(10_000);
      await queue.completeOffline(s2.id);

      expect(workflow.getQrStationState().sessionId).toBe(s2.id);

      // The first timer was cancelled; the replacement keeps its full duration.
      vi.advanceTimersByTime(44_000);

      expect(workflow.getQrStationState().sessionId).toBe(s2.id);

      vi.advanceTimersByTime(1_000);

      expect(workflow.getQrStationState().status).toBe('idle');
      expect(workflow.getQrStationState().sessionId).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('first-run guest-operation guard', () => {
  it('rejects Start until the local operator bootstrap is complete', () => {
    expect(() => assertOperatorBootstrapComplete(false)).toThrow(/operator.*passcode/i);
    expect(() => assertOperatorBootstrapComplete(true)).not.toThrow();
  });
});

describe('print choice at review', () => {
  function insertFrame(testStore: TestStore, width: number, height: number): string {
    const id = randomUUID();
    const art = testStore.vault.write('frames', Buffer.from(`frame-${id}`));
    testStore.database.raw
      .prepare(
        `INSERT INTO frames
          (id, name, encrypted_path, width, height, byte_size, sha256, revision, sort_order, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 10, ?, 0, NULL, 1, 1)`,
      )
      .run(
        id,
        `Frame ${width}x${height}`,
        art.relativePath,
        width,
        height,
        id.replace(/-/g, '').padEnd(64, '0'),
      );
    testStore.database.raw
      .prepare(
        `INSERT INTO frame_slots (frame_id, slot_index, name, x, y, width, height, crop_mode)
        VALUES (?, 1, 'Photo 1', 0.1, 0.1, 0.8, 0.8, 'crop-to-fill')`,
      )
      .run(id);
    return id;
  }

  function reviewSession(testStore: TestStore): string {
    const sessionId = randomUUID();
    testStore.repository.createSession(sessionId, 1_000);
    testStore.database.raw
      .prepare(
        "UPDATE sessions SET state = 'review', capture_count = 1, required_shot_count = 1 WHERE id = ?",
      )
      .run(sessionId);
    return sessionId;
  }

  it('queues the chosen copies only for a landscape 4R frame', async () => {
    const requests: [string, number][] = [];
    const print: WorkflowPrintPort = {
      requestSessionPrint: (sessionId: string, copies: number) =>
        requests.push([sessionId, copies]),
      attachSessionPhoto: () => undefined,
      discardWaitingSessionPrint: () => undefined,
      getSessionPrintStatus: () => null,
      subscribeSessionChanges: () => () => undefined,
    };
    ({ store, workflow } = createWorkflow(new SequencedCamera(['ready']), { print }));
    const strip = insertFrame(store, 1_200, 3_600);
    const fourR = insertFrame(store, 3_600, 2_400);
    const sessionId = reviewSession(store);
    await workflow.initialize();

    expect(() => workflow!.acceptPhotos(strip, { copies: 2 })).toThrow(/landscape 4R/);
    expect(store.repository.getSession(sessionId)?.state).toBe('review');
    expect(requests).toEqual([]);

    workflow.acceptPhotos(fourR, { copies: 3 });
    expect(requests).toEqual([[sessionId, 3]]);
  });

  it('does not print when printing is left off (the default)', async () => {
    const requests: unknown[] = [];
    const print: WorkflowPrintPort = {
      requestSessionPrint: (...args: unknown[]) => requests.push(args),
      attachSessionPhoto: () => undefined,
      discardWaitingSessionPrint: () => undefined,
      getSessionPrintStatus: () => null,
      subscribeSessionChanges: () => () => undefined,
    };
    ({ store, workflow } = createWorkflow(new SequencedCamera(['ready']), { print }));
    const fourR = insertFrame(store, 3_600, 2_400);
    reviewSession(store);
    await workflow.initialize();
    workflow.acceptPhotos(fourR);
    expect(requests).toEqual([]);
  });

  it('projects live print transitions, health pauses, reprints, and deduplication on single display', async () => {
    const testStore = createTestStore();
    store = testStore;
    const queue = new FakeUploadQueue();
    queue.testStore = testStore;

    const prints = new PrintRepository(testStore.database);
    const printer = new MockPrinterAdapter({ outputDirectory: null, printDurationMs: 40 });
    const settings = prints.getPrinterSettings();
    prints.updatePrinterSettings({
      printerName: MOCK_PRINTER_NAME,
      paperRawKind: 127,
      paperName: '102 x 152 mm (4 x 6 in)',
      timeoutSeconds: 240,
      expectedRevision: settings.revision,
    });
    const printService = new PrintService(
      prints,
      testStore.repository,
      testStore.vault,
      testStore.paths,
      printer,
      { tickMs: 1_000_000 },
    );
    await printService.start();

    try {
      const collageBytes = await sharp({
        create: { width: 1_800, height: 1_200, channels: 3, background: { r: 24, g: 80, b: 140 } },
      })
        .jpeg()
        .toBuffer();
      let resolveProcess: (() => void) | null = null;
      const imageProcessor: ImageProcessor = {
        process: () =>
          new Promise((resolve) => {
            resolveProcess = () =>
              resolve({
                bytes: collageBytes,
                width: 1_800,
                height: 1_200,
                byteSize: collageBytes.byteLength,
                timing: { validationMs: 1, slotsMs: 1, compositeMs: 1, totalMs: 3 },
              });
          }),
        validateSourceJpeg: () => Promise.resolve({ width: 1_000, height: 1_000 }),
        normalizeFramePng: () => Promise.reject(new Error('not used')),
        createThumbnail: () => Promise.reject(new Error('not used')),
        close: () => Promise.resolve(),
      };
      const frameService = {
        ensureDefaultFrame: () => Promise.resolve(undefined),
        ensureDefaultFrames: () => Promise.resolve({ option1: undefined, option2: undefined }),
        getFrameOptions: () => [null, null],
        getFrameSummaries: () => [],
        listFrames: () => [],
        toSummary: (f: StoredFrame) => ({
          id: f.id,
          name: f.name,
          width: f.width,
          height: f.height,
          byteSize: f.byteSize,
          mediaUrl: `grace-booth-media://asset/${f.id}`,
          slots: f.slots,
          revision: f.revision,
        }),
      } as unknown as FrameService;
      const qrService = {
        render: () => Promise.resolve({ imageDataUrl: 'data:image/png;base64,mockqr' }),
      } as unknown as QrService;

      workflow = new BoothWorkflow(
        testStore.repository,
        testStore.vault,
        new SequencedCamera(['ready']),
        frameService,
        imageProcessor,
        queue as unknown as UploadQueue,
        qrService,
        {
          isDualDisplayActive: () => false,
          now: () => 2_000,
          print: printService,
        },
      );

      const fourR = insertFrame(testStore, 1_800, 1_200);
      const sessionId = reviewSession(testStore);
      const written = testStore.vault.write('pending', collageBytes);
      testStore.database.raw
        .prepare(
          `INSERT INTO session_assets
            (id, session_id, kind, retake_round, shot_number, encrypted_path, content_type, width, height, byte_size, sha256, created_at)
          VALUES (?, ?, 'capture', 0, 1, ?, 'image/jpeg', 1800, 1200, ?, ?, 1)`,
        )
        .run(randomUUID(), sessionId, written.relativePath, written.byteSize, written.sha256);

      await workflow.initialize();
      expect(workflow.getSnapshot().printStatus).toBeNull();

      const emitted: BoothSnapshot[] = [];
      workflow.subscribe((snap) => emitted.push(snap));

      const accepted = workflow.acceptPhotos(fourR, { copies: 1 });
      expect(accepted.printStatus).toEqual({
        phase: 'preparing',
        origin: 'session',
        pendingCopies: 1,
        totalCopies: 1,
      });
      expect(emitted).toHaveLength(1);
      expect(emitted[0]).toEqual(accepted);

      printer.setStatus('offline');
      await printService.runQueuePass();
      resolveProcess!();
      await new Promise((resolve) => setTimeout(resolve, 25));

      expect(workflow.getSnapshot().printStatus).toMatchObject({
        phase: 'paused',
        origin: 'session',
        reason: 'offline',
        remainingCopies: 1,
        totalCopies: 1,
      });

      await queue.completeOffline(sessionId);
      expect(workflow.getSnapshot()).toMatchObject({
        screen: 'final',
        printStatus: {
          phase: 'paused',
          origin: 'session',
          reason: 'offline',
        },
      });

      emitted.length = 0;
      printer.setStatus('ready');
      await printService.runQueuePass();
      expect(workflow.getSnapshot().printStatus).toEqual({
        phase: 'printing',
        origin: 'session',
        stage: 'active',
        printedCopies: 0,
        remainingCopies: 1,
        totalCopies: 1,
      });
      expect(emitted).toHaveLength(1);

      await new Promise((resolve) => setTimeout(resolve, 60));
      await printService.runQueuePass();
      expect(workflow.getSnapshot().printStatus).toMatchObject({
        phase: 'completed',
        origin: 'session',
        totalCopies: 1,
      });

      printService.reprint(sessionId, 1);
      expect(workflow.getSnapshot().printStatus).toEqual({
        phase: 'printing',
        origin: 'reprint',
        stage: 'queued',
        printedCopies: 0,
        remainingCopies: 1,
        totalCopies: 1,
      });

      await workflow.close();
      const countAfterClose = emitted.length;
      printer.setStatus('offline');
      await printService.runQueuePass();
      expect(emitted).toHaveLength(countAfterClose);
    } finally {
      await printService.stop();
    }
  });

  it('avoids Screen 1 processing flash in dual display and hydrates completed prints onto Screen 2', async () => {
    const testStore = createTestStore();
    store = testStore;
    const queue = new FakeUploadQueue();
    queue.testStore = testStore;

    const prints = new PrintRepository(testStore.database);
    const printer = new MockPrinterAdapter({ outputDirectory: null, printDurationMs: 40 });
    const settings = prints.getPrinterSettings();
    prints.updatePrinterSettings({
      printerName: MOCK_PRINTER_NAME,
      paperRawKind: 127,
      paperName: '102 x 152 mm (4 x 6 in)',
      timeoutSeconds: 240,
      expectedRevision: settings.revision,
    });
    const printService = new PrintService(
      prints,
      testStore.repository,
      testStore.vault,
      testStore.paths,
      printer,
      { tickMs: 1_000_000 },
    );
    await printService.start();

    try {
      const collageBytes = await sharp({
        create: { width: 1_800, height: 1_200, channels: 3, background: { r: 24, g: 80, b: 140 } },
      })
        .jpeg()
        .toBuffer();
      const imageProcessor: ImageProcessor = {
        process: () =>
          Promise.resolve({
            bytes: collageBytes,
            width: 1_800,
            height: 1_200,
            byteSize: collageBytes.byteLength,
            timing: { validationMs: 1, slotsMs: 1, compositeMs: 1, totalMs: 3 },
          }),
        validateSourceJpeg: () => Promise.resolve({ width: 1_000, height: 1_000 }),
        normalizeFramePng: () => Promise.reject(new Error('not used')),
        createThumbnail: () => Promise.reject(new Error('not used')),
        close: () => Promise.resolve(),
      };
      const frameService = {
        ensureDefaultFrame: () => Promise.resolve(undefined),
        ensureDefaultFrames: () => Promise.resolve({ option1: undefined, option2: undefined }),
        getFrameOptions: () => [null, null],
        getFrameSummaries: () => [],
        listFrames: () => [],
        toSummary: (f: StoredFrame) => ({
          id: f.id,
          name: f.name,
          width: f.width,
          height: f.height,
          byteSize: f.byteSize,
          mediaUrl: `grace-booth-media://asset/${f.id}`,
          slots: f.slots,
          revision: f.revision,
        }),
      } as unknown as FrameService;
      const qrService = {
        render: () => Promise.resolve({ imageDataUrl: 'data:image/png;base64,mockqr' }),
      } as unknown as QrService;

      workflow = new BoothWorkflow(
        testStore.repository,
        testStore.vault,
        new SequencedCamera(['ready']),
        frameService,
        imageProcessor,
        queue as unknown as UploadQueue,
        qrService,
        {
          isDualDisplayActive: () => true,
          now: () => 2_000,
          print: printService,
        },
      );

      const fourR = insertFrame(testStore, 1_800, 1_200);
      const sessionId = reviewSession(testStore);
      const written = testStore.vault.write('pending', collageBytes);
      testStore.database.raw
        .prepare(
          `INSERT INTO session_assets
            (id, session_id, kind, retake_round, shot_number, encrypted_path, content_type, width, height, byte_size, sha256, created_at)
          VALUES (?, ?, 'capture', 0, 1, ?, 'image/jpeg', 1800, 1200, ?, ?, 1)`,
        )
        .run(randomUUID(), sessionId, written.relativePath, written.byteSize, written.sha256);

      await workflow.initialize();

      const screen1Emissions: BoothSnapshot[] = [];
      const qrEmissions: QrStationState[] = [];
      workflow.subscribe((snap) => screen1Emissions.push(snap));
      workflow.subscribeQrStation((state) => qrEmissions.push(state));

      const afterAccept = workflow.acceptPhotos(fourR, { copies: 1 });
      expect(afterAccept).toMatchObject({ screen: 'attract', printStatus: null });
      expect(screen1Emissions.map((snap) => snap.screen)).toEqual(['attract']);

      for (let pass = 0; pass < 6; pass += 1) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        await printService.runQueuePass();
        if (printService.getSessionPrintStatus(sessionId)?.phase === 'completed') break;
      }

      await queue.completeOffline(sessionId);
      expect(workflow.getQrStationState()).toMatchObject({
        status: 'active',
        sessionId,
        printStatus: {
          phase: 'completed',
          origin: 'session',
          totalCopies: 1,
        },
      });

      qrEmissions.length = 0;
      printService.reprint(sessionId, 1);
      expect(workflow.getQrStationState().printStatus).toEqual({
        phase: 'printing',
        origin: 'reprint',
        stage: 'queued',
        printedCopies: 0,
        remainingCopies: 1,
        totalCopies: 1,
      });
      expect(qrEmissions).toHaveLength(1);

      const dismissed = workflow.dismissQrStation(sessionId);
      expect(dismissed.printStatus).toBeNull();
      expect(screen1Emissions.some((snap) => snap.screen === 'processing')).toBe(false);
    } finally {
      await printService.stop();
    }
  });

  it('marks waiting copies photo_interrupted on processing failure and discards them on restartSession', async () => {
    const testStore = createTestStore();
    store = testStore;
    const queue = new FakeUploadQueue();
    queue.testStore = testStore;

    const prints = new PrintRepository(testStore.database);
    const printer = new MockPrinterAdapter({ outputDirectory: null, printDurationMs: 40 });
    const settings = prints.getPrinterSettings();
    prints.updatePrinterSettings({
      printerName: MOCK_PRINTER_NAME,
      paperRawKind: 127,
      paperName: '102 x 152 mm (4 x 6 in)',
      timeoutSeconds: 240,
      expectedRevision: settings.revision,
    });
    const printService = new PrintService(
      prints,
      testStore.repository,
      testStore.vault,
      testStore.paths,
      printer,
      { tickMs: 1_000_000 },
    );
    await printService.start();

    try {
      const imageProcessor: ImageProcessor = {
        process: () => Promise.reject(new Error('collage exploded')),
        validateSourceJpeg: () => Promise.resolve({ width: 1_000, height: 1_000 }),
        normalizeFramePng: () => Promise.reject(new Error('not used')),
        createThumbnail: () => Promise.reject(new Error('not used')),
        close: () => Promise.resolve(),
      };
      const frameService = {
        ensureDefaultFrame: () => Promise.resolve(undefined),
        ensureDefaultFrames: () => Promise.resolve({ option1: undefined, option2: undefined }),
        getFrameOptions: () => [null, null],
        getFrameSummaries: () => [],
        listFrames: () => [],
        toSummary: (f: StoredFrame) => ({
          id: f.id,
          name: f.name,
          width: f.width,
          height: f.height,
          byteSize: f.byteSize,
          mediaUrl: `grace-booth-media://asset/${f.id}`,
          slots: f.slots,
          revision: f.revision,
        }),
      } as unknown as FrameService;
      const qrService = {
        render: () => Promise.resolve({ imageDataUrl: 'data:image/png;base64,mockqr' }),
      } as unknown as QrService;

      workflow = new BoothWorkflow(
        testStore.repository,
        testStore.vault,
        new SequencedCamera(['ready', 'ready']),
        frameService,
        imageProcessor,
        queue as unknown as UploadQueue,
        qrService,
        {
          captureOverride: { countdownMs: 60_000, reviewMode: 'continuous' },
          isDualDisplayActive: () => false,
          now: () => 2_000,
          print: printService,
        },
      );

      const fourR = insertFrame(testStore, 1_800, 1_200);
      const sessionId = reviewSession(testStore);
      const written = testStore.vault.write('pending', Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
      testStore.database.raw
        .prepare(
          `INSERT INTO session_assets
            (id, session_id, kind, retake_round, shot_number, encrypted_path, content_type, width, height, byte_size, sha256, created_at)
          VALUES (?, ?, 'capture', 0, 1, ?, 'image/jpeg', 1000, 1000, ?, ?, 1)`,
        )
        .run(randomUUID(), sessionId, written.relativePath, written.byteSize, written.sha256);

      await workflow.initialize();
      workflow.acceptPhotos(fourR, { copies: 2 });
      await new Promise((resolve) => setTimeout(resolve, 25));

      expect(workflow.getSnapshot()).toMatchObject({
        screen: 'recovery',
        state: 'interrupted',
        printStatus: {
          phase: 'paused',
          origin: 'session',
          reason: 'photo_interrupted',
          remainingCopies: 2,
          totalCopies: 2,
        },
      });

      const restartEmissions: BoothSnapshot[] = [];
      workflow.subscribe((snap) => restartEmissions.push(snap));

      const restarted = await workflow.restartSession(sessionId);
      expect(restarted).toMatchObject({
        screen: 'countdown',
        state: 'countdown',
        printStatus: null,
      });
      expect(restartEmissions).toHaveLength(1);
      expect(restartEmissions[0]).toEqual(restarted);
      expect(prints.listJobsForSession(sessionId)).toEqual([]);
      expect(printService.getSessionPrintStatus(sessionId)).toBeNull();
    } finally {
      await printService.stop();
    }
  });
});

function createWorkflow(
  camera: CameraAdapter,
  overrides: {
    captureOverride?: CapturePolicyOverride | null;
    now?: () => number;
    imageProcessor?: ImageProcessor;
    print?: WorkflowPrintPort;
  } = {},
): { store: TestStore; workflow: BoothWorkflow } {
  const testStore = createTestStore();
  const queue = new FakeUploadQueue();
  const imageProcessor: ImageProcessor = overrides.imageProcessor ?? {
    process: () => Promise.reject(new Error('not used')),
    validateSourceJpeg: () => Promise.reject(new Error('not used')),
    normalizeFramePng: () => Promise.reject(new Error('not used')),
    createThumbnail: () => Promise.reject(new Error('not used')),
    close: () => Promise.resolve(),
  };
  const frameService = {
    ensureDefaultFrame: () => Promise.resolve(undefined),
    ensureDefaultFrames: () => Promise.resolve({ option1: undefined, option2: undefined }),
    getFrameOptions: () => [null, null],
    getFrameSummaries: () => [],
    listFrames: () => [],
    toSummary: (f: StoredFrame) => ({
      id: f.id,
      name: f.name,
      width: 1200,
      height: 3600,
      byteSize: 1000,
      mediaUrl: 'grace-booth-media://asset/test',
      slots: f.slots,
      revision: f.revision,
    }),
  } as unknown as FrameService;
  const qrService = {
    render: () => Promise.resolve({ imageDataUrl: 'data:image/png;base64,mockqr' }),
  } as unknown as QrService;
  return {
    store: testStore,
    workflow: new BoothWorkflow(
      testStore.repository,
      testStore.vault,
      camera,
      frameService,
      imageProcessor,
      queue as unknown as UploadQueue,
      qrService,
      {
        captureOverride: overrides.captureOverride ?? null,
        isDualDisplayActive: () => false,
        now: overrides.now ?? (() => 2_000),
        ...(overrides.print ? { print: overrides.print } : {}),
      },
    ),
  };
}

class FakeUploadQueue extends EventEmitter {
  testStore?: TestStore;

  start(): void {
    return undefined;
  }
  stop(): void {
    return undefined;
  }
  wake(): void {
    return undefined;
  }
  completeOffline(sessionId: string): Promise<void> {
    if (this.testStore) {
      this.testStore.database.raw
        .prepare("UPDATE sessions SET state = 'ready', public_secret_ref = 'sec-1' WHERE id = ?")
        .run(sessionId);
    }
    this.emit('ready', sessionId);
    return Promise.resolve();
  }
  readDeliverySecret(): {
    photoSessionId: string;
    publicToken: string;
    ready: {
      status: string;
      readyAt: string;
      expiresAt: string;
      publicPageOrigin: string;
      publicPath: string;
    };
  } {
    const readyAt = 1_000_000;
    const expiresAt = readyAt + 30 * 24 * 60 * 60 * 1_000;
    return {
      photoSessionId: randomUUID(),
      publicToken: Buffer.alloc(32, 0x41).toString('base64url'),
      ready: {
        status: 'ready',
        readyAt: new Date(readyAt).toISOString(),
        expiresAt: new Date(expiresAt).toISOString(),
        publicPageOrigin: 'https://test',
        publicPath: '/photo',
      },
    };
  }
}

class SequencedCamera implements CameraAdapter {
  connectCalls = 0;

  constructor(private readonly sequence: ('ready' | 'throw')[]) {}

  connect(): Promise<CameraStatus> {
    const result = this.sequence[this.connectCalls] ?? this.sequence.at(-1) ?? 'ready';
    this.connectCalls += 1;
    return result === 'throw'
      ? Promise.reject(new Error('camera unavailable'))
      : Promise.resolve(readyStatus());
  }

  getStatus(): Promise<CameraStatus> {
    return Promise.resolve(readyStatus());
  }

  capture(request: CaptureRequest): Promise<CaptureResult> {
    void request;
    return Promise.reject(new Error('not used'));
  }

  disconnect(): Promise<void> {
    return Promise.resolve();
  }
}

class BufferCamera implements CameraAdapter {
  connectCalls = 0;
  captures = 0;

  constructor(private readonly sequence: ('ready' | 'throw')[] = ['ready']) {}

  connect(): Promise<CameraStatus> {
    const result = this.sequence[this.connectCalls] ?? this.sequence.at(-1) ?? 'ready';
    this.connectCalls += 1;
    return result === 'throw'
      ? Promise.reject(new Error('camera unavailable'))
      : Promise.resolve(readyStatus());
  }

  getStatus(): Promise<CameraStatus> {
    return Promise.resolve(readyStatus());
  }

  capture(request: CaptureRequest): Promise<CaptureResult> {
    this.captures += 1;
    return Promise.resolve({
      kind: 'buffer',
      captureId: request.captureId,
      bytes: Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x01, 0x02]),
      contentType: 'image/jpeg',
      capturedAt: 1,
    });
  }

  disconnect(): Promise<void> {
    return Promise.resolve();
  }
}

function readyStatus(): CameraStatus {
  return {
    adapter: 'mock',
    state: 'ready',
    code: null,
    operatorMessage: 'ready',
    capabilities: { stillCapture: true, preview: false },
    checkedAt: 2_000,
  };
}
