import type { BoothSnapshot, GuestErrorCode, SessionState } from '@grace-booth/shared';

export type AdminView = 'frame' | 'settings' | 'gallery';

export type RecoveryVariant = 'camera' | 'upload' | 'interrupted';

export type ActionState = {
  busy: boolean;
  message: string | null;
};

export const EMPTY_BOOTH_SNAPSHOT: BoothSnapshot = {
  screen: 'attract',
  state: 'attract',
  sessionId: null,
  shotNumber: null,
  captureCount: 0,
  countdownEndsAt: null,
  cameraPreviewEnabled: false,
  media: {
    captureUrls: [],
    collageUrl: null,
    qrImageUrl: null,
  },
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
};

export function recoveryVariantFor(
  state: SessionState | null,
  errorCode: GuestErrorCode | null,
): RecoveryVariant {
  if (state === 'upload_failed' || errorCode === 'upload_failed') {
    return 'upload';
  }

  if (
    state === 'camera_error' ||
    errorCode === 'camera_unavailable' ||
    errorCode === 'capture_failed'
  ) {
    return 'camera';
  }

  return 'interrupted';
}

export function safeGuestMessage(message: string | null, fallback: string): string {
  if (!message) {
    return fallback;
  }

  const unsafePattern =
    /(?:[a-z]:\\|\/users\/|\/home\/|bearer\s|token=|service[_-]?role|stack\s*trace)/i;
  return unsafePattern.test(message) ? fallback : message;
}
