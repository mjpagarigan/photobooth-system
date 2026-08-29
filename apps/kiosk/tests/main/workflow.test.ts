import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';

import type {
  CameraAdapter,
  CameraStatus,
  CaptureRequest,
  CaptureResult,
} from '@grace-booth/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { assertOperatorBootstrapComplete } from '../../src/main/auth/bootstrap-guard.js';
import { RendererFrameBroker } from '../../src/main/camera/renderer-frame-broker.js';
import { SonyCameraAdapter } from '../../src/main/camera/sony-camera-adapter.js';
import { WebcamCameraAdapter } from '../../src/main/camera/webcam-camera-adapter.js';
import type { QrService } from '../../src/main/cloud/qr-service.js';
import type { UploadQueue } from '../../src/main/cloud/upload-queue.js';
import type { StoredFrame } from '../../src/main/database/repositories.js';
import type { FrameService } from '../../src/main/frame/frame-service.js';
import type { ImageProcessor } from '../../src/main/image/image-worker-client.js';
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
        shotCountdownsMs: [60_000, 60_000, 60_000],
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
        shotCountdownsMs: [60_000, 60_000, 60_000],
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

describe('per-shot countdown schedule', () => {
  const capturingProcessor: ImageProcessor = {
    process: () => Promise.reject(new Error('not used')),
    validateSourceJpeg: () => Promise.resolve({ width: 1_000, height: 1_000 }),
    normalizeFramePng: () => Promise.reject(new Error('not used')),
    createThumbnail: () => Promise.reject(new Error('not used')),
    close: () => Promise.resolve(),
  };

  it('gives shot 1 an 8-second window and shots 2–3 five seconds each', async () => {
    vi.useFakeTimers();
    try {
      const clock = 1_000;
      const camera = new BufferCamera();
      ({ store, workflow } = createWorkflow(camera, {
        shotCountdownsMs: [8_000, 5_000, 5_000],
        now: () => clock,
        imageProcessor: capturingProcessor,
      }));
      await workflow.initialize();

      const started = await workflow.start();
      expect(started.countdownEndsAt).toBe(9_000);

      await vi.advanceTimersByTimeAsync(8_000);
      expect(store.repository.requireSession(started.sessionId!).captureCount).toBe(1);
      expect(workflow.getSnapshot().countdownEndsAt).toBe(6_000);

      await vi.advanceTimersByTimeAsync(5_000);
      expect(store.repository.requireSession(started.sessionId!).captureCount).toBe(2);
      expect(workflow.getSnapshot().countdownEndsAt).toBe(6_000);

      await vi.advanceTimersByTimeAsync(5_000);
      const finished = store.repository.requireSession(started.sessionId!);
      expect(finished.captureCount).toBe(3);
      expect(finished.state).toBe('review');
      expect(workflow.getSnapshot().countdownEndsAt).toBeNull();
      expect(camera.captures).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('collapses every shot window when the e2e override supplies one duration', async () => {
    vi.useFakeTimers();
    try {
      const camera = new BufferCamera();
      ({ store, workflow } = createWorkflow(camera, {
        shotCountdownsMs: [40, 40, 40],
        imageProcessor: capturingProcessor,
      }));
      await workflow.initialize();

      const started = await workflow.start();
      expect(started.countdownEndsAt).toBe(2_040);
      await vi.advanceTimersByTimeAsync(40);
      expect(store.repository.requireSession(started.sessionId!).captureCount).toBe(1);
      expect(workflow.getSnapshot().countdownEndsAt).toBe(2_040);
    } finally {
      vi.useRealTimers();
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

  function createCapturingWorkflow() {
    return createWorkflow(new BufferCamera(), {
      shotCountdownsMs: [60_000, 60_000, 60_000],
      imageProcessor: capturingProcessor,
    });
  }

  it('cancel during countdown deletes created assets and vault files and reaches attract', async () => {
    vi.useFakeTimers();
    try {
      const created = createCapturingWorkflow();
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

  it('purges only the partial captures; a later session is unaffected', async () => {
    vi.useFakeTimers();
    try {
      const created = createCapturingWorkflow();
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
      const created = createCapturingWorkflow();
      store = created.store;
      const activeWorkflow = (workflow = created.workflow);
      await activeWorkflow.initialize();

      expect(() => activeWorkflow.cancelSession()).not.toThrow();
      expect(activeWorkflow.cancelSession()).toMatchObject({ screen: 'attract', state: null });

      const started = await activeWorkflow.start();
      await vi.advanceTimersByTimeAsync(60_000);
      // Force a terminal state behind the workflow's back to prove the guard.
      store.database.raw
        .prepare("UPDATE sessions SET state = 'final' WHERE id = ?")
        .run(started.sessionId!);

      const result = activeWorkflow.cancelSession();
      expect(result.state).toBe('final');
      expect(store.repository.getSession(started.sessionId!)).not.toBeNull();

      // A second immediate cancel after returning to attract stays safe.
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
        shotCountdownsMs: [1_000, 1_000, 1_000],
        imageProcessor: capturingProcessor,
      });
      store = created.store;
      const activeWorkflow = (workflow = created.workflow);
      await activeWorkflow.initialize();

      const first = await activeWorkflow.start();
      expect(first.state).toBe('countdown');

      // Countdown expires -> captureNext -> broker.requestFrame() in flight
      await vi.advanceTimersByTimeAsync(1_000);
      expect(lastFrameRequest).not.toBeNull();

      // In flight capture request is pending. Cancel the session!
      const cancelled = activeWorkflow.cancelSession();
      expect(cancelled.screen).toBe('attract');

      // Verify adapter is not busy and can immediately start and capture a new session
      const second = await activeWorkflow.start();
      expect(second.state).toBe('countdown');
      lastFrameRequest = null;
      await vi.advanceTimersByTimeAsync(1_000);
      expect(lastFrameRequest).not.toBeNull();

      // Submit valid frame for the second session
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
      normalizeFramePng: () => Promise.resolve({ bytes: Buffer.from([]), width: 1200, height: 3600 }),
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
        shotCountdownsMs: [0, 0, 0],
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
        createdAt: 1000,
        updatedAt: 1000,
      },
      [
        { slotIndex: 1, name: 'Photo 1', x: 0.1, y: 0.1, width: 0.8, height: 0.25, cropMode: 'crop-to-fill' },
        { slotIndex: 2, name: 'Photo 2', x: 0.1, y: 0.4, width: 0.8, height: 0.25, cropMode: 'crop-to-fill' },
        { slotIndex: 3, name: 'Photo 3', x: 0.1, y: 0.7, width: 0.8, height: 0.25, cropMode: 'crop-to-fill' },
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
});

describe('first-run guest-operation guard', () => {
  it('rejects Start until the local operator bootstrap is complete', () => {
    expect(() => assertOperatorBootstrapComplete(false)).toThrow(/operator.*passcode/i);
    expect(() => assertOperatorBootstrapComplete(true)).not.toThrow();
  });
});

function createWorkflow(
  camera: CameraAdapter,
  overrides: {
    shotCountdownsMs?: readonly [number, number, number];
    now?: () => number;
    imageProcessor?: ImageProcessor;
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
      slots: [],
      revision: 0,
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
        shotCountdownsMs: overrides.shotCountdownsMs ?? [60_000, 60_000, 60_000],
        isDualDisplayActive: () => false,
        now: overrides.now ?? (() => 2_000),
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
