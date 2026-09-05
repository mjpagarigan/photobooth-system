// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest';

import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import type {
  AdminHealth,
  AdminSettings,
  BoothSnapshot,
  CameraAdapterKind,
  CameraResolution,
  GalleryItem,
  GraceBoothBridge,
  RpcResult,
} from '@grace-booth/shared';

import { App } from '../../src/renderer/App';
import { DEFAULT_FRAME_LAYOUT, LOCAL_FIXTURES } from '../../src/renderer/local-fixtures';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const FRAME_ID = '22222222-2222-4222-8222-222222222222';

function ok<T>(data: T): RpcResult<T> {
  return { ok: true, data };
}

const FRAME = {
  id: FRAME_ID,
  name: 'M.A.T. 42nd Anniversary',
  width: 1200,
  height: 3600,
  byteSize: 44_090,
  mediaUrl: LOCAL_FIXTURES.matFrame,
  revision: 1,
  slots: DEFAULT_FRAME_LAYOUT,
} satisfies AdminSettings['activeFrame'];

const FRAME_2 = {
  ...FRAME,
  id: '00000000-0000-4000-8000-000000000002',
  name: 'CCF Alabang 42nd Anniversary',
} satisfies AdminSettings['activeFrame'];

const SETTINGS: AdminSettings = {
  googleFormsUrl: null,
  localRetentionDays: 60,
  cloudRetentionDays: 30,
  lan: {
    enabled: false,
    bindHost: '127.0.0.1',
    port: 4310,
    tlsConfigured: false,
    certificateFingerprint: null,
  },
  activeFrame: FRAME,
  cameraAdapter: 'webcam',
  cameraDeviceId: null,
  cameraResolution: '1080p',
  supabaseUrl: null,
  supabasePublishableKey: null,
  dualDisplay: {
    mode: 'auto',
    swapDisplays: false,
    qrDismissSeconds: 45,
  },
  googlePhotos: {
    connectedEmail: null,
    albumId: null,
    albumTitle: null,
    albumShareUrl: null,
    enabled: false,
  },
  revision: 1,
};

const HEALTH: AdminHealth = {
  camera: { state: 'healthy', code: null, message: 'Camera ready.', checkedAt: 1 },
  cloud: { state: 'healthy', code: null, message: 'Cloud ready.', checkedAt: 1 },
  database: { state: 'healthy', code: null, message: 'Database ready.', checkedAt: 1 },
  encryption: { state: 'healthy', code: null, message: 'Encryption ready.', checkedAt: 1 },
};

const ATTRACT: BoothSnapshot = {
  screen: 'attract',
  state: null,
  sessionId: null,
  shotNumber: null,
  captureCount: 0,
  countdownEndsAt: null,
  cameraPreviewEnabled: false,
  media: { captureUrls: [], collageUrl: null, qrImageUrl: null },
  controls: {
    canStart: true,
    canRetakeAll: false,
    canAcceptPhotos: false,
    canRetryUpload: false,
    canFinishOffline: false,
    canFinish: false,
  },
  errorCode: null,
  message: null,
};

function sessionSnapshot(patch: Partial<BoothSnapshot> = {}): BoothSnapshot {
  return {
    screen: 'countdown',
    state: 'countdown',
    sessionId: SESSION_ID,
    shotNumber: 1,
    captureCount: 0,
    countdownEndsAt: Date.now() + 5_000,
    cameraPreviewEnabled: false,
    media: { captureUrls: [], collageUrl: null, qrImageUrl: null },
    controls: {
      canStart: false,
      canRetakeAll: false,
      canAcceptPhotos: false,
      canRetryUpload: false,
      canFinishOffline: false,
      canFinish: false,
    },
    errorCode: null,
    message: null,
    ...patch,
  };
}

type BridgeHarness = {
  bootstrapPasscodeMock: Mock<GraceBoothBridge['admin']['bootstrapPasscode']>;
  bridge: GraceBoothBridge;
  cancelSessionMock: Mock<GraceBoothBridge['booth']['cancelSession']>;
  emit: (snapshot: BoothSnapshot) => void;
  getAuthStatusMock: Mock<GraceBoothBridge['admin']['getAuthStatus']>;
  getRecentMock: Mock<GraceBoothBridge['gallery']['getRecent']>;
  restartSessionMock: Mock<GraceBoothBridge['admin']['restartSession']>;
  startMock: Mock<GraceBoothBridge['booth']['start']>;
};

function createBridge(
  initial: BoothSnapshot = ATTRACT,
  cameraAdapter: CameraAdapterKind = 'mock',
  cameraDeviceId: string | null = null,
  cameraResolution: CameraResolution = '1080p',
): BridgeHarness {
  let listener: ((snapshot: BoothSnapshot) => void) | null = null;
  const startMock = vi.fn<GraceBoothBridge['booth']['start']>().mockResolvedValue(
    ok(
      sessionSnapshot({
        screen: 'countdown',
        state: 'countdown',
        shotNumber: 1,
      }),
    ),
  );
  const restartSessionMock = vi
    .fn<GraceBoothBridge['admin']['restartSession']>()
    .mockResolvedValue(ok(ATTRACT));
  const cancelSessionMock = vi
    .fn<GraceBoothBridge['booth']['cancelSession']>()
    .mockResolvedValue(ok(ATTRACT));
  const getRecentMock = vi.fn<GraceBoothBridge['gallery']['getRecent']>().mockResolvedValue(ok([]));
  const getAuthStatusMock = vi
    .fn<GraceBoothBridge['admin']['getAuthStatus']>()
    .mockResolvedValue(ok({ configured: true, authenticated: false, expiresAt: null }));
  const bootstrapPasscodeMock = vi
    .fn<GraceBoothBridge['admin']['bootstrapPasscode']>()
    .mockResolvedValue(
      ok({ configured: true, authenticated: true, expiresAt: Date.now() + 60_000 }),
    );

  const bridge: GraceBoothBridge = {
    booth: {
      getSnapshot: vi.fn().mockResolvedValue(ok(initial)),
      start: startMock,
      retakeAll: vi.fn().mockResolvedValue(ok(initial)),
      acceptPhotos: vi.fn<(input: { frameId: string }) => Promise<RpcResult<BoothSnapshot>>>(() =>
        Promise.resolve(ok(initial)),
      ),
      retryUpload: vi.fn().mockResolvedValue(ok(initial)),
      finishOffline: vi.fn().mockResolvedValue(ok(initial)),
      done: vi.fn().mockResolvedValue(ok(initial)),
      cancelSession: cancelSessionMock,
      getCameras: vi.fn().mockResolvedValue(
        ok({
          adapter: cameraAdapter,
          deviceId: cameraDeviceId,
          resolution: cameraResolution,
          status: {
            adapter: cameraAdapter,
            state: 'ready' as const,
            code: null,
            operatorMessage: 'Ready',
            capabilities: { stillCapture: true, preview: true },
            checkedAt: 1,
          },
        }),
      ),
      setCamera: vi.fn().mockResolvedValue(
        ok({
          adapter: 'webcam' as const,
          deviceId: null,
          resolution: '1080p' as const,
          status: {
            adapter: 'webcam' as const,
            state: 'ready' as const,
            code: null,
            operatorMessage: 'Ready',
            capabilities: { stillCapture: true, preview: true },
            checkedAt: 1,
          },
        }),
      ),
      submitCameraFrame: vi.fn().mockResolvedValue(ok({})),
      subscribe: vi.fn((nextListener: (snapshot: BoothSnapshot) => void) => {
        listener = nextListener;
        return () => {
          listener = null;
        };
      }),
      onCameraFrameRequest: vi.fn().mockReturnValue(() => undefined),
    },
    qrStation: {
      getState: vi.fn().mockResolvedValue(
        ok({
          status: 'idle' as const,
          sessionId: null,
          collageUrl: null,
          qrImageUrl: null,
          expiresAt: null,
          durationSeconds: 45,
          message: null,
          canRetryUpload: false,
        }),
      ),
      dismiss: vi.fn().mockResolvedValue(
        ok({
          status: 'idle' as const,
          sessionId: null,
          collageUrl: null,
          qrImageUrl: null,
          expiresAt: null,
          durationSeconds: 45,
          message: null,
          canRetryUpload: false,
        }),
      ),
      subscribe: vi.fn().mockReturnValue(() => undefined),
    },
    gallery: {
      getRecent: getRecentMock,
      repairCloudPhoto: vi.fn().mockResolvedValue(
        ok({ status: 'repaired' as const, message: 'Cloud copy repaired.' }),
      ),
    },
    admin: {
      getAuthStatus: getAuthStatusMock,
      login: vi
        .fn()
        .mockResolvedValue(
          ok({ configured: true, authenticated: true, expiresAt: Date.now() + 60_000 }),
        ),
      logout: vi.fn().mockResolvedValue(ok({})),
      bootstrapPasscode: bootstrapPasscodeMock,
      changePasscode: vi.fn().mockResolvedValue(ok({})),
      getSettings: vi.fn().mockResolvedValue(ok(SETTINGS)),
      saveSettings: vi.fn().mockResolvedValue(ok(SETTINGS)),
      getDisplays: vi.fn().mockResolvedValue(ok([])),
      swapDisplays: vi.fn().mockResolvedValue(ok([])),
      saveDualDisplaySettings: vi.fn().mockResolvedValue(ok({ mode: 'auto', swapDisplays: false, qrDismissSeconds: 45 })),
      getGooglePhotosStatus: vi.fn().mockResolvedValue(ok({
        config: { connectedEmail: null, albumId: null, albumTitle: null, albumShareUrl: null, enabled: false },
        stats: { syncedCount: 0, pendingCount: 0, failedCount: 0, lastSyncedAt: null },
        hasRefreshToken: false,
        hasCredentials: true,
      })),
      saveGooglePhotosConfig: vi.fn().mockImplementation((cfg) => Promise.resolve(ok(cfg))),
      createGooglePhotosAlbum: vi.fn().mockResolvedValue(ok({ albumId: 'album_created_123', albumTitle: 'M.A.T. Photobooth', shareUrl: 'https://photos.app.goo.gl/created' })),
      listGooglePhotosAlbums: vi.fn().mockResolvedValue(ok([])),
      resolveGooglePhotosAlbum: vi.fn().mockResolvedValue(ok({ albumId: 'album_123', albumTitle: 'Sunday Service', shareUrl: 'https://photos.app.goo.gl/xyz' })),
      syncGooglePhotosNow: vi.fn().mockResolvedValue(ok({ processed: 0, succeeded: 0, failed: 0 })),
      testGooglePhotosUpload: vi.fn().mockResolvedValue(ok({ success: true, message: 'Google Photos album connectivity verified successfully.' })),
      disconnectGooglePhotos: vi.fn().mockResolvedValue(ok({})),
      listFrames: vi.fn().mockResolvedValue(ok([FRAME])),
      chooseFrame: vi.fn().mockResolvedValue(ok(null)),
      addFrame: vi.fn().mockResolvedValue(ok(null)),
      updateFrameLayout: vi.fn().mockResolvedValue(ok(FRAME)),
      deleteFrame: vi.fn().mockResolvedValue(ok([FRAME])),
      activateFrame: vi.fn().mockResolvedValue(ok(FRAME)),
      moveFrame: vi.fn().mockResolvedValue(ok([FRAME])),
      replaceFrameImage: vi.fn().mockResolvedValue(ok(FRAME)),
      chooseLanCertificate: vi.fn().mockResolvedValue(ok(null)),
      listUploadJobs: vi.fn().mockResolvedValue(ok({ items: [], nextCursor: null })),
      retryUpload: vi.fn(),
      getHealth: vi.fn().mockResolvedValue(ok(HEALTH)),
      restartSession: restartSessionMock,
      connectCloud: vi.fn().mockResolvedValue(ok({ message: 'Connected.' })),
      openExternalUrl: vi.fn().mockResolvedValue(ok({})),
    },
  };

  return {
    bootstrapPasscodeMock,
    bridge,
    cancelSessionMock,
    emit: (snapshot: BoothSnapshot) => {
      if (!listener) {
        throw new Error('Booth listener has not been installed');
      }
      listener(snapshot);
    },
    getAuthStatusMock,
    getRecentMock,
    restartSessionMock,
    startMock,
  };
}

class AudioStub {
  currentTime = 0;
  preload = '';
  load = vi.fn();
  play = vi.fn().mockResolvedValue(undefined);
}

function cameraStream(width = 1_920, height = 1_080) {
  const track = {
    addEventListener: vi.fn(),
    getSettings: vi.fn(() => ({ width, height })),
    stop: vi.fn(),
  };
  return {
    getTracks: () => [track],
    getVideoTracks: () => [track],
    track,
  };
}

function stubCamera(getUserMedia: Mock): void {
  vi.stubGlobal('navigator', {
    mediaDevices: {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      enumerateDevices: vi.fn(() =>
        Promise.resolve([
          { deviceId: 'sony-uvc', kind: 'videoinput', label: 'Sony ILCE-7M4', groupId: 'g1' },
        ]),
      ),
      getUserMedia,
    },
  });
}

beforeEach(() => {
  window.history.replaceState({}, '', '/');
  vi.stubGlobal('Audio', AudioStub);
  const assignedStreams = new WeakMap<HTMLMediaElement, MediaProvider | null>();
  Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', {
    configurable: true,
    get(this: HTMLMediaElement) {
      return assignedStreams.get(this) ?? null;
    },
    set(this: HTMLMediaElement, value: MediaProvider | null) {
      assignedStreams.set(this, value);
    },
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('App guest flow', () => {
  it('starts the bridge-driven capture flow and primes local audio', async () => {
    const harness = createBridge();
    window.graceBooth = harness.bridge;
    const user = userEvent.setup();

    render(<App />);
    await screen.findByTestId('attract-screen');
    await user.click(screen.getByRole('button', { name: /start photo session/i }));

    expect(await screen.findByTestId('capture-screen')).toHaveAttribute('data-phase', 'countdown');
    expect(screen.getByText('Photo 1 of 3')).toBeVisible();
    expect(harness.startMock).toHaveBeenCalledOnce();
  });

  it('starts a webcam session immediately and acquires the configured 720p stream', async () => {
    const stream = cameraStream(1_280, 720);
    const getUserMedia = vi.fn(() => Promise.resolve(stream));
    stubCamera(getUserMedia);
    const harness = createBridge(ATTRACT, 'webcam', 'sony-uvc', '720p');
    harness.startMock.mockResolvedValue(ok(sessionSnapshot({ cameraPreviewEnabled: true })));
    window.graceBooth = harness.bridge;
    const user = userEvent.setup();
    render(<App />);
    await screen.findByTestId('attract-screen');

    await user.click(screen.getByRole('button', { name: /start photo session/i }));
    expect(await screen.findByTestId('capture-screen')).toHaveAttribute('data-phase', 'countdown');
    expect(harness.startMock).toHaveBeenCalledOnce();
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledOnce());
    const [[constraints]] = getUserMedia.mock.calls as unknown as [[MediaStreamConstraints]];
    const video = constraints.video as MediaTrackConstraints;
    expect(video).toMatchObject({
      deviceId: { exact: 'sony-uvc' },
      width: { ideal: 1_280 },
      height: { ideal: 720 },
    });
    expect(video.width).not.toHaveProperty('min');
    expect(stream.track.stop).not.toHaveBeenCalled();

    act(() => harness.emit(ATTRACT));
    await screen.findByTestId('attract-screen');
    await waitFor(() => expect(stream.track.stop).toHaveBeenCalledOnce());
  });

  it('does not block session start on the native Sony adapter in the renderer', async () => {
    const harness = createBridge(ATTRACT, 'sony');
    window.graceBooth = harness.bridge;
    const user = userEvent.setup();
    render(<App />);
    await screen.findByTestId('attract-screen');
    await user.click(screen.getByRole('button', { name: /start photo session/i }));

    expect(harness.startMock).toHaveBeenCalledOnce();
  });

  it('maps review to exactly the two approved guest decisions', async () => {
    const harness = createBridge();
    window.graceBooth = harness.bridge;
    render(<App />);
    await screen.findByTestId('attract-screen');

    act(() =>
      harness.emit(
        sessionSnapshot({
          screen: 'review',
          state: 'review',
          captureCount: 3,
          media: {
            captureUrls: ['/mock/photo-1.jpg', '/mock/photo-2.jpg', '/mock/photo-3.jpg'],
            collageUrl: null,
            frame: FRAME,
            frames: [FRAME, FRAME_2],
            qrImageUrl: null,
          },
          controls: {
            canStart: false,
            canRetakeAll: true,
            canAcceptPhotos: true,
            canRetryUpload: false,
            canFinishOffline: false,
            canFinish: false,
          },
        }),
      ),
    );

    expect(await screen.findByTestId('review-screen')).toBeVisible();
    expect(screen.getByTestId('collage-option-1')).toBeVisible();
    expect(screen.getByTestId('collage-option-2')).toBeVisible();
    expect(screen.getByRole('button', { name: /retake all photos/i })).toBeVisible();
    expect(screen.getByRole('button', { name: /use these photos/i })).toBeVisible();
  });

  it('never renders a final QR until both verified media URLs and final state exist', async () => {
    const harness = createBridge();
    window.graceBooth = harness.bridge;
    render(<App />);
    await screen.findByTestId('attract-screen');

    act(() =>
      harness.emit(
        sessionSnapshot({
          screen: 'final',
          state: 'ready',
          media: {
            captureUrls: [],
            collageUrl: 'grace-booth-media://asset/collage',
            qrImageUrl: null,
          },
        }),
      ),
    );
    expect(await screen.findByTestId('recovery-interrupted')).toBeVisible();
    expect(screen.queryByAltText(/qr code/i)).not.toBeInTheDocument();

    act(() =>
      harness.emit(
        sessionSnapshot({
          screen: 'final',
          state: 'final',
          media: {
            captureUrls: [],
            collageUrl: 'grace-booth-media://asset/collage',
            qrImageUrl: 'grace-booth-media://asset/qr',
          },
          controls: {
            canStart: false,
            canRetakeAll: false,
            canAcceptPhotos: false,
            canRetryUpload: false,
            canFinishOffline: false,
            canFinish: true,
          },
        }),
      ),
    );
    expect(await screen.findByTestId('final-screen')).toBeVisible();
    expect(screen.getByAltText(/qr code for your private/i)).toHaveAttribute(
      'src',
      'grace-booth-media://asset/qr',
    );
  });

  it('requires an operator login before restarting a camera-error session', async () => {
    const cameraFailure = sessionSnapshot({
      screen: 'recovery',
      state: 'camera_error',
      errorCode: 'camera_unavailable',
    });
    const harness = createBridge(cameraFailure);
    window.graceBooth = harness.bridge;
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: /restart session/i }));
    expect(await screen.findByRole('dialog', { name: /operator restart/i })).toBeVisible();
    await user.type(screen.getByLabelText('Passcode'), 'secure88');
    await user.click(screen.getByRole('button', { name: /restart session/i }));

    await waitFor(() => expect(harness.restartSessionMock).toHaveBeenCalledWith(SESSION_ID));
    expect(await screen.findByTestId('attract-screen')).toBeVisible();
  });

  it('requires the first operator passcode before guest operation', async () => {
    const harness = createBridge();
    harness.getAuthStatusMock.mockResolvedValue(
      ok({ configured: false, authenticated: false, expiresAt: null }),
    );
    window.graceBooth = harness.bridge;
    const user = userEvent.setup();
    render(<App />);

    expect(await screen.findByRole('dialog', { name: /create operator passcode/i })).toBeVisible();
    expect(screen.queryByRole('button', { name: /cancel|close/i })).not.toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.getByRole('dialog', { name: /create operator passcode/i })).toBeVisible();
    await user.type(screen.getByLabelText('Passcode'), 'secure88');
    await user.type(screen.getByLabelText('Confirm passcode'), 'secure88');
    await user.click(screen.getByRole('button', { name: /save passcode/i }));

    expect(await screen.findByTestId('attract-screen')).toBeVisible();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(harness.bootstrapPasscodeMock).toHaveBeenCalledWith('secure88');
  });
});

describe('recent gallery', () => {
  const galleryItem = (sessionId: string): GalleryItem => ({
    sessionId,
    previewDataUrl: 'data:image/jpeg;base64,cHJldmlldw==',
    qrDataUrl: 'data:image/png;base64,cXI=',
    metadata: {
      capturedAt: 1_700_000_000_000,
      photoCount: 3,
      frameName: 'Test Frame',
      uploadStatus: 'uploaded',
      cloudExpiresAt: 1_800_000_000_000,
    },
  });

  it('opens from the final screen, shows tiles, and closes with ESC without starting a session', async () => {
    const harness = createBridge();
    window.graceBooth = harness.bridge;
    harness.getRecentMock.mockResolvedValue(
      ok([galleryItem(SESSION_ID), galleryItem('22222222-3333-4333-8333-333333333333')]),
    );
    const user = userEvent.setup();
    render(<App />);
    await screen.findByTestId('attract-screen');

    act(() =>
      harness.emit(
        sessionSnapshot({
          screen: 'final',
          state: 'final',
          media: {
            captureUrls: [],
            collageUrl: 'grace-booth-media://asset/collage',
            qrImageUrl: 'grace-booth-media://asset/qr',
          },
          controls: {
            canStart: false,
            canRetakeAll: false,
            canAcceptPhotos: false,
            canRetryUpload: false,
            canFinishOffline: false,
            canFinish: true,
          },
        }),
      ),
    );
    await screen.findByTestId('final-screen');

    await user.click(screen.getByRole('button', { name: /recent/i }));
    expect(await screen.findByTestId('recent-gallery')).toBeVisible();
    expect(screen.getByTestId('gallery-item-1')).toBeVisible();
    expect(screen.getByTestId('gallery-item-2')).toBeVisible();
    expect(harness.startMock).not.toHaveBeenCalled();

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByTestId('recent-gallery')).not.toBeInTheDocument());
    expect(harness.startMock).not.toHaveBeenCalled();
  });
});

describe('guest ESC cancellation', () => {
  it('ignores a single ESC and cancels only on a second ESC inside the arm window', async () => {
    const harness = createBridge();
    window.graceBooth = harness.bridge;
    const user = userEvent.setup();
    render(<App />);
    await screen.findByTestId('attract-screen');

    act(() => harness.emit(sessionSnapshot()));
    expect(await screen.findByTestId('capture-screen')).toBeVisible();

    await user.keyboard('{Escape}');
    expect(screen.getByTestId('cancel-hint')).toBeVisible();
    expect(harness.cancelSessionMock).not.toHaveBeenCalled();

    await user.keyboard('{Escape}');
    await waitFor(() => expect(harness.cancelSessionMock).toHaveBeenCalledOnce());
    expect(await screen.findByTestId('attract-screen')).toBeVisible();
  });

  it('auto-disarms the hint so a later ESC does not cancel', async () => {
    const harness = createBridge();
    window.graceBooth = harness.bridge;
    const user = userEvent.setup();
    render(<App />);
    await screen.findByTestId('attract-screen');

    act(() => harness.emit(sessionSnapshot()));
    await screen.findByTestId('capture-screen');

    await user.keyboard('{Escape}');
    expect(screen.getByTestId('cancel-hint')).toBeVisible();

    await act(() => new Promise((resolve) => setTimeout(resolve, 2_300)));
    expect(screen.queryByTestId('cancel-hint')).not.toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.getByTestId('cancel-hint')).toBeVisible();
    expect(harness.cancelSessionMock).not.toHaveBeenCalled();
  }, 10_000);

  it('lets an open dialog keep ESC for itself instead of cancelling the session', async () => {
    const harness = createBridge();
    window.graceBooth = harness.bridge;
    const user = userEvent.setup();
    render(<App />);
    await screen.findByTestId('attract-screen');

    act(() => harness.emit(sessionSnapshot()));
    await screen.findByTestId('capture-screen');

    // Opens the operator login dialog on top of the live session.
    await user.keyboard('{Control>}{Shift>}a{/Shift}{/Control}');
    expect(await screen.findByRole('dialog', { name: /operator access/i })).toBeVisible();

    await user.keyboard('{Escape}');
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: /operator access/i })).not.toBeInTheDocument(),
    );
    expect(harness.cancelSessionMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId('cancel-hint')).not.toBeInTheDocument();

    // ESC now targets the session again.
    await user.keyboard('{Escape}');
    expect(screen.getByTestId('cancel-hint')).toBeVisible();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(harness.cancelSessionMock).toHaveBeenCalledOnce());
  });
});
