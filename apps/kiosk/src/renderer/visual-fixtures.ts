import type {
  AdminHealth,
  AdminSettings,
  BoothSnapshot,
  FrameSummary,
  GalleryItem,
  PrinterHealth,
  QrStationState,
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
  printerHealth?: PrinterHealth | null;
  recentItems?: GalleryItem[];
  settings: AdminSettings | null;
  snapshot: BoothSnapshot;
};

export type VisualFixtureMode =
  | 'attract'
  | 'attract-printing'
  | 'attract-printed'
  | 'attract-print-paused'
  | 'countdown'
  | 'shot-review'
  | 'review'
  | 'review-4-slot'
  | 'processing'
  | 'processing-printing'
  | 'uploading-backoff'
  | 'final'
  | 'final-printing'
  | 'final-printed'
  | 'final-print-paused'
  | 'recovery-camera'
  | 'recovery-upload'
  | 'recovery-upload-printed'
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
  | 'camera-setup'
  | 'recent-gallery';

export const QR_STATION_VISUAL_MODES = [
  'qr-station-active',
  'qr-station-printing',
  'qr-station-printed',
  'qr-station-preparing',
  'qr-station-preparing-collage',
  'qr-station-preparing-no-print',
] as const;

export type QrStationVisualFixtureMode = (typeof QR_STATION_VISUAL_MODES)[number];

const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const FRAME_ID = '22222222-2222-4222-8222-222222222222';
const JOB_ID = '33333333-3333-4333-8333-333333333333';
const CAPTURE_URLS = ['/mock/photo-1.jpg', '/mock/photo-2.jpg', '/mock/photo-3.jpg'];
const CAPTURE_URLS_4 = [
  '/mock/photo-1.jpg',
  '/mock/photo-2.jpg',
  '/mock/photo-3.jpg',
  '/mock/photo-4.jpg',
];

const FOUR_SLOT_FRAME_LAYOUT: FrameSummary['slots'] = [
  {
    slotIndex: 1,
    zIndex: 0,
    name: 'Photo 1',
    x: 0.05,
    y: 0.07,
    width: 0.43,
    height: 0.39,
    cropMode: 'crop-to-fill',
  },
  {
    slotIndex: 2,
    zIndex: 1,
    name: 'Photo 2',
    x: 0.52,
    y: 0.07,
    width: 0.43,
    height: 0.39,
    cropMode: 'crop-to-fill',
  },
  {
    slotIndex: 3,
    zIndex: 2,
    name: 'Photo 3',
    x: 0.05,
    y: 0.5,
    width: 0.43,
    height: 0.39,
    cropMode: 'crop-to-fill',
  },
  {
    slotIndex: 4,
    zIndex: 3,
    name: 'Photo 4',
    x: 0.52,
    y: 0.5,
    width: 0.43,
    height: 0.39,
    cropMode: 'crop-to-fill',
  },
];

const FOUR_SLOT_FRAME: FrameSummary = {
  id: '00000000-0000-4000-8000-000000000004',
  name: '4R Four-Slot Keepsake',
  width: 1800,
  height: 1200,
  byteSize: 44_090,
  mediaUrl: LOCAL_FIXTURES.matFrame,
  revision: 1,
  slots: FOUR_SLOT_FRAME_LAYOUT,
};

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
  recruitmentButtonText: 'Join a ministry',
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
  webcamAlwaysActive: false,
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
  capture: {
    countdownSeconds: 8,
    reviewMode: 'per_shot',
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
    canAcceptShot: false,
    canRetakeShot: false,
    canRetakeAll: false,
    canAcceptPhotos: false,
    canRetryUpload: false,
    canFinishOffline: false,
    canFinish: false,
  },
  errorCode: null,
  message: null,
  printStatus: null,
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
  const width = 1200;
  const height = 3600;
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
  return canvas.toDataURL('image/jpeg', 0.95);
}

function buildFourSlotFrameOverlay(): string {
  if (typeof document === 'undefined') {
    return LOCAL_FIXTURES.matFrame;
  }
  const width = 900;
  const height = 600;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) {
    return LOCAL_FIXTURES.matFrame;
  }

  context.fillStyle = '#f8f5ef';
  context.fillRect(0, 0, width, height);

  context.globalCompositeOperation = 'destination-out';
  for (const slot of FOUR_SLOT_FRAME_LAYOUT) {
    context.fillRect(
      Math.round(slot.x * width),
      Math.round(slot.y * height),
      Math.round(slot.width * width),
      Math.round(slot.height * height),
    );
  }

  context.globalCompositeOperation = 'source-over';
  context.strokeStyle = '#d6cfc2';
  context.lineWidth = 4;
  context.strokeRect(10, 10, width - 20, height - 20);
  context.fillStyle = '#1d1d1f';
  context.font = '600 22px system-ui, sans-serif';
  context.textAlign = 'center';
  context.fillText('M.A.T. PHOTOBOOTH · FOUR-SLOT KEEPSAKE', width / 2, height - 22);

  return canvas.toDataURL('image/png');
}

function isQrStationVisualFixtureMode(value: string): value is QrStationVisualFixtureMode {
  return (QR_STATION_VISUAL_MODES as readonly string[]).includes(value);
}

export async function readQrStationVisualFixture(search: string): Promise<QrStationState | null> {
  if (!import.meta.env.DEV) {
    return null;
  }

  const seed = new URLSearchParams(search).get('visual');
  if (!seed || !isQrStationVisualFixtureMode(seed)) {
    return null;
  }

  return createQrStationVisualState(seed);
}

export async function createQrStationVisualState(
  mode: QrStationVisualFixtureMode = 'qr-station-active',
): Promise<QrStationState> {
  if (mode === 'qr-station-preparing') {
    return {
      status: 'preparing',
      sessionId: SESSION_ID,
      collageUrl: null,
      qrImageUrl: null,
      expiresAt: null,
      durationSeconds: 45,
      message: 'Creating your collage…',
      canRetryUpload: false,
      canFinishOffline: false,
      printStatus: {
        phase: 'preparing',
        origin: 'session',
        pendingCopies: 2,
        totalCopies: 2,
      },
    };
  }

  if (mode === 'qr-station-preparing-collage') {
    return {
      status: 'preparing',
      sessionId: SESSION_ID,
      collageUrl: await buildReadyCollage(),
      qrImageUrl: null,
      expiresAt: null,
      durationSeconds: 45,
      message: 'Uploading for your phone…',
      canRetryUpload: false,
      canFinishOffline: false,
      printStatus: {
        phase: 'printing',
        origin: 'session',
        stage: 'active',
        printedCopies: 0,
        remainingCopies: 2,
        totalCopies: 2,
      },
    };
  }

  if (mode === 'qr-station-preparing-no-print') {
    return {
      status: 'preparing',
      sessionId: SESSION_ID,
      collageUrl: null,
      qrImageUrl: null,
      expiresAt: null,
      durationSeconds: 45,
      message: 'Creating your collage…',
      canRetryUpload: false,
      canFinishOffline: false,
      printStatus: null,
    };
  }

  const printStatus: QrStationState['printStatus'] =
    mode === 'qr-station-printing'
      ? {
          phase: 'printing',
          origin: 'session',
          stage: 'active',
          printedCopies: 0,
          remainingCopies: 2,
          totalCopies: 2,
        }
      : mode === 'qr-station-printed'
        ? {
            phase: 'completed',
            origin: 'session',
            totalCopies: 2,
            completedAt: 1_786_883_400_000,
          }
        : null;

  return {
    status: 'active',
    sessionId: SESSION_ID,
    collageUrl: await buildReadyCollage(),
    qrImageUrl: await buildReadyQr(),
    expiresAt: mode === 'qr-station-printing' ? null : Date.now() + 45_000,
    durationSeconds: 45,
    message: null,
    canRetryUpload: false,
    canFinishOffline: false,
    deliveryMode: 'cloud',
    printStatus,
  };
}

export async function createVisualSeedPayload(
  mode: VisualFixtureMode,
): Promise<VisualSeedPayload | null> {
  let snapshot = BASE_SNAPSHOT;
  let adminView: AdminView | null = null;
  let countdownSeconds: number | undefined;
  let printerHealth: PrinterHealth | null | undefined;

  switch (mode) {
    case 'attract':
      break;
    case 'attract-printing':
      snapshot = {
        ...BASE_SNAPSHOT,
        printStatus: {
          phase: 'printing',
          origin: 'session',
          stage: 'active',
          printedCopies: 0,
          remainingCopies: 2,
          totalCopies: 2,
        },
      };
      break;
    case 'attract-printed':
      snapshot = {
        ...BASE_SNAPSHOT,
        printStatus: {
          phase: 'completed',
          origin: 'session',
          totalCopies: 2,
          completedAt: 1_786_883_400_000,
        },
      };
      break;
    case 'attract-print-paused':
      snapshot = {
        ...BASE_SNAPSHOT,
        printStatus: {
          phase: 'paused',
          origin: 'session',
          reason: 'offline',
          detail: 'Printer is offline. Copies wait until the printer reconnects.',
          printedCopies: 0,
          remainingCopies: 2,
          totalCopies: 2,
        },
      };
      printerHealth = {
        status: 'offline',
        printerName: 'Epson L8050',
        message: 'Check the printer power and USB cable.',
        queuedCount: 2,
        attentionCount: 0,
        checkedAt: 1_786_883_400_000,
      };
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
    case 'shot-review': {
      const fourSlotFrame: FrameSummary = {
        ...FOUR_SLOT_FRAME,
        mediaUrl: buildFourSlotFrameOverlay(),
      };
      snapshot = withSession({
        screen: 'shot_review',
        state: 'shot_review',
        shotNumber: 2,
        captureCount: 1,
        requiredShotCount: 4,
        media: {
          captureUrls: CAPTURE_URLS_4.slice(0, 2),
          collageUrl: null,
          frame: fourSlotFrame,
          frames: [fourSlotFrame],
          qrImageUrl: null,
        },
        controls: { canAcceptShot: true, canRetakeShot: true },
      });
      break;
    }
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
    case 'review-4-slot': {
      const fourSlotFrame: FrameSummary = {
        ...FOUR_SLOT_FRAME,
        mediaUrl: buildFourSlotFrameOverlay(),
      };
      snapshot = withSession({
        screen: 'review',
        state: 'review',
        shotNumber: null,
        captureCount: 4,
        requiredShotCount: 4,
        media: {
          captureUrls: CAPTURE_URLS_4,
          collageUrl: null,
          frame: fourSlotFrame,
          frames: [fourSlotFrame],
          qrImageUrl: null,
        },
        controls: { canRetakeAll: true, canAcceptPhotos: true },
      });
      break;
    }
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
    case 'processing-printing':
      snapshot = withSession({
        screen: 'processing',
        state: 'processing',
        shotNumber: null,
        captureCount: 3,
        media: { captureUrls: CAPTURE_URLS, collageUrl: null, qrImageUrl: null },
        message: 'Adding your three photos to the CCF Alabang frame.',
        printStatus: {
          phase: 'preparing',
          origin: 'session',
          pendingCopies: 2,
          totalCopies: 2,
        },
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
    case 'final-printing':
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
        printStatus: {
          phase: 'printing',
          origin: 'session',
          stage: 'active',
          printedCopies: 1,
          remainingCopies: 1,
          totalCopies: 2,
        },
      });
      break;
    case 'final-printed':
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
        printStatus: {
          phase: 'completed',
          origin: 'session',
          totalCopies: 2,
          completedAt: 1_786_883_400_000,
        },
      });
      break;
    case 'final-print-paused':
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
        printStatus: {
          phase: 'paused',
          origin: 'session',
          reason: 'paper_out',
          detail: 'Printer is out of paper.',
          printedCopies: 0,
          remainingCopies: 2,
          totalCopies: 2,
        },
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
    case 'recovery-upload-printed':
      snapshot = withSession({
        screen: 'recovery',
        state: 'upload_failed',
        captureCount: 3,
        errorCode: 'upload_failed',
        message: 'Your photo is safe on this booth. Try the secure upload again.',
        media: { captureUrls: CAPTURE_URLS, collageUrl: '/mock/photo-3.jpg', qrImageUrl: null },
        controls: { canRetryUpload: true },
        printStatus: {
          phase: 'completed',
          origin: 'session',
          totalCopies: 1,
          completedAt: 1_786_883_400_000,
        },
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
    case 'recent-gallery':
      break;
    default:
      return null;
  }

  const galleryItem: GalleryItem | null =
    mode === 'admin-gallery' || mode === 'recent-gallery'
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
            printable: false,
          },
        }
      : null;
  const payload: VisualSeedPayload = {
    adminView,
    health:
      mode === 'admin-settings-degraded'
        ? {
            ...HEALTH,
            camera: {
              ...HEALTH.camera,
              state: 'degraded',
              message: 'Preview signal is intermittent.',
            },
          }
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
    recentItems:
      galleryItem && mode === 'recent-gallery'
        ? Array.from({ length: 8 }, (_, index) => ({
            ...galleryItem,
            sessionId: `${String(index + 1).padStart(8, '0')}-0000-4000-8000-000000000000`,
            metadata: {
              ...galleryItem.metadata,
              capturedAt: galleryItem.metadata.capturedAt - index * 60_000,
            },
          }))
        : galleryItem
          ? [galleryItem]
          : [],
    settings: adminView ? SETTINGS : null,
    snapshot,
  };
  if (mode === 'operator-login') payload.dialog = { intent: 'admin', mode: 'login' };
  if (mode === 'operator-bootstrap') payload.dialog = { intent: 'bootstrap', mode: 'bootstrap' };
  if (mode === 'operator-restart') payload.dialog = { intent: 'restart', mode: 'restart' };
  if (mode === 'camera-setup') payload.cameraSetupOpen = true;
  if (printerHealth !== undefined) payload.printerHealth = printerHealth;
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
