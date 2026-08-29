import type {
  AdminHealth,
  AdminSettings,
  BoothSnapshot,
  FrameSummary,
  GalleryItem,
  UploadJobSummary,
} from '@grace-booth/shared';

import type { AdminView } from './types';
import { ANNIVERSARY_FRAME_LAYOUT, DEFAULT_FRAME_LAYOUT, LOCAL_FIXTURES } from './local-fixtures';

export type VisualSeedPayload = {
  adminView: AdminView | null;
  cameraSetupOpen?: boolean;
  countdownSeconds?: number;
  dialog?: { intent: 'admin' | 'bootstrap' | 'restart'; mode: 'bootstrap' | 'login' | 'restart' };
  health: AdminHealth | null;
  jobs: UploadJobSummary[];
  operatorBusy?: boolean;
  operatorError?: string | null;
  operatorStatus?: string | null;
  recentItems?: GalleryItem[];
  settings: AdminSettings | null;
  snapshot: BoothSnapshot;
};

export type VisualFixtureMode =
  | 'attract'
  | 'countdown'
  | 'review'
  | 'processing'
  | 'uploading-backoff'
  | 'final'
  | 'recovery-camera'
  | 'recovery-upload'
  | 'recovery-interrupted'
  | 'admin-frame'
  | 'admin-frame-error'
  | 'admin-gallery'
  | 'admin-gallery-empty'
  | 'admin-settings'
  | 'admin-settings-degraded'
  | 'admin-settings-error'
  | 'operator-login'
  | 'operator-bootstrap'
  | 'operator-restart'
  | 'camera-setup';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const FRAME_ID = '22222222-2222-4222-8222-222222222222';
const JOB_ID = '33333333-3333-4333-8333-333333333333';
const CAPTURE_URLS = ['/mock/photo-1.jpg', '/mock/photo-2.jpg', '/mock/photo-3.jpg'];

const DEFAULT_FRAME: FrameSummary = {
  id: FRAME_ID,
  name: 'M.A.T. 42nd Anniversary',
  width: 1200,
  height: 3600,
  byteSize: 44_090,
  mediaUrl: LOCAL_FIXTURES.matFrame,
  revision: 3,
  slots: DEFAULT_FRAME_LAYOUT,
};

const DEFAULT_FRAME_2: FrameSummary = {
  ...DEFAULT_FRAME,
  id: '00000000-0000-4000-8000-000000000002',
  name: 'CCF Alabang 42nd Anniversary',
  mediaUrl: LOCAL_FIXTURES.annivFrame,
  slots: ANNIVERSARY_FRAME_LAYOUT,
};

const SETTINGS: AdminSettings = {
  googleFormsUrl: 'https://example.invalid/fixture-form',
  localRetentionDays: 60,
  cloudRetentionDays: 30,
  lan: {
    enabled: false,
    bindHost: '127.0.0.1',
    port: 4310,
    tlsConfigured: false,
    certificateFingerprint: null,
  },
  activeFrame: DEFAULT_FRAME,
  frames: [DEFAULT_FRAME, DEFAULT_FRAME_2],
  cameraAdapter: 'mock',
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
    connectedEmail: 'operator@example.invalid',
    albumId: 'fixture_album',
    albumTitle: 'Fixture album',
    albumShareUrl: 'https://example.invalid/fixture-album',
    enabled: true,
  },
  revision: 3,
};

const HEALTH: AdminHealth = {
  camera: {
    state: 'healthy',
    code: null,
    message: 'Deterministic mock camera ready.',
    checkedAt: 1,
  },
  cloud: { state: 'healthy', code: null, message: 'Cloud delivery ready.', checkedAt: 1 },
  database: { state: 'healthy', code: null, message: 'Local database ready.', checkedAt: 1 },
  encryption: { state: 'healthy', code: null, message: 'DPAPI encryption ready.', checkedAt: 1 },
};

const JOBS: UploadJobSummary[] = [
  {
    id: JOB_ID,
    sessionId: SESSION_ID,
    state: 'failed',
    attemptCount: 4,
    automaticRetryIndex: 3,
    nextAttemptAt: null,
    lastErrorCode: 'connection_unavailable',
    lastErrorMessage: 'Secure upload could not be reached.',
    createdAt: 1_786_879_800_000,
    updatedAt: 1_786_883_400_000,
  },
];

const BASE_SNAPSHOT: BoothSnapshot = {
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

type SnapshotUpdate = Omit<Partial<BoothSnapshot>, 'controls' | 'media'> & {
  controls?: Partial<BoothSnapshot['controls']>;
  media?: Partial<BoothSnapshot['media']>;
};

function withSession(update: SnapshotUpdate): BoothSnapshot {
  const { controls, media, ...rest } = update;
  return {
    ...BASE_SNAPSHOT,
    sessionId: SESSION_ID,
    ...rest,
    media: { ...BASE_SNAPSHOT.media, ...media },
    controls: { ...BASE_SNAPSHOT.controls, ...controls },
  };
}

async function buildReadyQr(): Promise<string> {
  const { toDataURL } = await import('qrcode');
  return toDataURL('https://example.invalid/photo#0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefg', {
    errorCorrectionLevel: 'M',
    margin: 4,
    width: 360,
  });
}

async function loadFixtureImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener('load', () => resolve(image), { once: true });
    image.addEventListener('error', () => reject(new Error(`visual_fixture_unavailable:${src}`)), {
      once: true,
    });
    image.src = src;
  });
}

function drawFixtureSlot(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  const sourceAspect = image.naturalWidth / image.naturalHeight;
  const targetAspect = width / height;
  let sourceX = 0;
  let sourceY = 0;
  let sourceWidth = image.naturalWidth;
  let sourceHeight = image.naturalHeight;
  if (sourceAspect > targetAspect) {
    sourceWidth = sourceHeight * targetAspect;
    sourceX = (image.naturalWidth - sourceWidth) / 2;
  } else {
    sourceHeight = sourceWidth / targetAspect;
    sourceY = (image.naturalHeight - sourceHeight) / 2;
  }
  context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, x, y, width, height);
}

async function buildReadyCollage(): Promise<string> {
  const width = 600;
  const height = 1_800;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('visual_fixture_canvas_unavailable');
  context.fillStyle = '#000000';
  context.fillRect(0, 0, width, height);

  const captures = await Promise.all(CAPTURE_URLS.map(loadFixtureImage));
  for (const slot of [...DEFAULT_FRAME.slots].sort(
    (left, right) => left.slotIndex - right.slotIndex,
  )) {
    const capture = captures[slot.slotIndex - 1];
    if (!capture) continue;
    drawFixtureSlot(
      context,
      capture,
      slot.x * width,
      slot.y * height,
      slot.width * width,
      slot.height * height,
    );
  }

  context.drawImage(await loadFixtureImage(DEFAULT_FRAME.mediaUrl), 0, 0, width, height);
  return canvas.toDataURL('image/jpeg', 0.9);
}

export async function createVisualSeedPayload(
  mode: VisualFixtureMode,
): Promise<VisualSeedPayload | null> {
  let snapshot = BASE_SNAPSHOT;
  let adminView: AdminView | null = null;
  let countdownSeconds: number | undefined;

  switch (mode) {
    case 'attract':
      break;
    case 'countdown':
      countdownSeconds = 5;
      snapshot = withSession({
        screen: 'countdown',
        state: 'countdown',
        shotNumber: 2,
        captureCount: 1,
        media: { captureUrls: CAPTURE_URLS.slice(0, 1), collageUrl: null, qrImageUrl: null },
      });
      break;
    case 'review':
      snapshot = withSession({
        screen: 'review',
        state: 'review',
        shotNumber: null,
        captureCount: 3,
        media: {
          captureUrls: CAPTURE_URLS,
          collageUrl: null,
          frame: DEFAULT_FRAME,
          frames: [DEFAULT_FRAME, DEFAULT_FRAME_2],
          qrImageUrl: null,
        },
        controls: { canRetakeAll: true, canAcceptPhotos: true },
      });
      break;
    case 'processing':
      snapshot = withSession({
        screen: 'processing',
        state: 'processing',
        shotNumber: null,
        captureCount: 3,
        media: { captureUrls: CAPTURE_URLS, collageUrl: null, qrImageUrl: null },
        message: 'Adding your three photos to the CCF Alabang frame.',
      });
      break;
    case 'uploading-backoff':
      snapshot = withSession({
        screen: 'processing',
        state: 'pending_upload',
        shotNumber: null,
        captureCount: 3,
        media: { captureUrls: CAPTURE_URLS, collageUrl: null, qrImageUrl: null },
        message: 'Your collage is saved. The next secure upload attempt will begin shortly.',
      });
      break;
    case 'final':
      snapshot = withSession({
        screen: 'final',
        state: 'final',
        shotNumber: null,
        captureCount: 3,
        media: {
          captureUrls: CAPTURE_URLS,
          collageUrl: await buildReadyCollage(),
          frame: DEFAULT_FRAME,
          qrImageUrl: await buildReadyQr(),
        },
        controls: { canFinish: true },
      });
      break;
    case 'recovery-camera':
      snapshot = withSession({
        screen: 'recovery',
        state: 'camera_error',
        errorCode: 'camera_unavailable',
        message: 'The camera needs an operator check before this session can continue.',
      });
      break;
    case 'recovery-upload':
      snapshot = withSession({
        screen: 'recovery',
        state: 'upload_failed',
        captureCount: 3,
        errorCode: 'upload_failed',
        message: 'Your photo is safe on this booth. Try the secure upload again.',
        media: { captureUrls: CAPTURE_URLS, collageUrl: '/mock/photo-3.jpg', qrImageUrl: null },
        controls: { canRetryUpload: true },
      });
      break;
    case 'recovery-interrupted':
      snapshot = withSession({
        screen: 'recovery',
        state: 'interrupted',
        errorCode: 'interrupted',
      });
      break;
    case 'admin-frame':
      adminView = 'frame';
      break;
    case 'admin-frame-error':
      adminView = 'frame';
      break;
    case 'admin-gallery':
    case 'admin-gallery-empty':
      adminView = 'gallery';
      break;
    case 'admin-settings':
    case 'admin-settings-degraded':
    case 'admin-settings-error':
      adminView = 'settings';
      break;
    case 'operator-login':
    case 'operator-bootstrap':
    case 'operator-restart':
    case 'camera-setup':
      break;
    default:
      return null;
  }

  const galleryItem: GalleryItem | null =
    mode === 'admin-gallery'
      ? {
          sessionId: SESSION_ID,
          previewDataUrl: await buildReadyCollage(),
          qrDataUrl: await buildReadyQr(),
          metadata: {
            capturedAt: 1_786_883_400_000,
            photoCount: 3,
            frameName: DEFAULT_FRAME.name,
            uploadStatus: 'failed',
            cloudExpiresAt: 1_789_475_400_000,
          },
        }
      : null;
  const payload: VisualSeedPayload = {
    adminView,
    health:
      mode === 'admin-settings-degraded'
        ? { ...HEALTH, camera: { ...HEALTH.camera, state: 'degraded', message: 'Preview signal is intermittent.' } }
        : adminView
          ? HEALTH
          : null,
    jobs: adminView ? JOBS : [],
    operatorBusy: false,
    operatorError:
      mode === 'admin-frame-error' || mode === 'admin-settings-error'
        ? 'The fixture could not save this change. Review the highlighted values and retry.'
        : null,
    operatorStatus: mode === 'admin-settings' ? 'Settings are synchronized.' : null,
    recentItems: galleryItem ? [galleryItem] : [],
    settings: adminView ? SETTINGS : null,
    snapshot,
  };
  if (mode === 'operator-login') payload.dialog = { intent: 'admin', mode: 'login' };
  if (mode === 'operator-bootstrap') payload.dialog = { intent: 'bootstrap', mode: 'bootstrap' };
  if (mode === 'operator-restart') payload.dialog = { intent: 'restart', mode: 'restart' };
  if (mode === 'camera-setup') payload.cameraSetupOpen = true;
  return countdownSeconds === undefined ? payload : { ...payload, countdownSeconds };
}

export async function readVisualFixture(search: string): Promise<VisualSeedPayload | null> {
  if (!import.meta.env.DEV) {
    return null;
  }

  const seed = new URLSearchParams(search).get('visual');
  if (!seed) {
    return null;
  }

  return createVisualSeedPayload(seed as VisualFixtureMode);
}
