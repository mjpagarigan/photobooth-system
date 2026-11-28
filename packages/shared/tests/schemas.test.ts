import { describe, expect, it } from 'vitest';
import {
  BoothControlsSchema,
  CaptureSettingsSchema,
  ConfirmUploadResponseSchema,
  CreateUploadRequestSchema,
  DEFAULT_CAPTURE_SETTINGS,
  FrameLayoutSchema,
  GalleryItemMetadataSchema,
  GuestScreenSchema,
  IpcContracts,
  MAX_FRAME_SLOTS,
  OptionalGoogleFormsUrlSchema,
  QrStationStateSchema,
  RecruitmentButtonTextSchema,
  SaveCaptureSettingsInputSchema,
  SessionStateSchema,
  isAllowedGoogleFormsUrl,
  isCancellableSessionState,
  isCaptureScreen,
  isSessionPrintActive,
  qrStationAllowsAutoDismiss,
} from '../src/index.js';

const slots = [1, 2, 3].map((slotIndex) => ({
  slotIndex,
  name: `Photo ${slotIndex}`,
  x: 0.1,
  y: (slotIndex - 1) * 0.3,
  width: 0.8,
  height: 0.28,
  cropMode: 'crop-to-fill' as const,
}));

describe('shared boundary schemas', () => {
  it('accepts valid CreateUploadRequest with 1200x3600 strip dimensions', () => {
    const valid = {
      action: 'create' as const,
      clientSessionId: 'cda39163-9036-4acd-ae10-0c08fdb39022',
      contentType: 'image/jpeg' as const,
      byteSize: 1_500_000,
      sha256: 'a'.repeat(64),
      width: 1200,
      height: 3600,
      googleFormsUrl: null,
      capturedAt: '2026-08-24T12:00:00.000Z',
    };
    expect(CreateUploadRequestSchema.parse(valid)).toEqual({
      ...valid,
      recruitmentButtonText: 'Join a ministry',
    });
    expect(CreateUploadRequestSchema.parse({ ...valid, byteSize: 20_000_000 }).byteSize).toBe(
      20_000_000,
    );
  });

  it('accepts exactly three normalized slots', () => {
    expect(FrameLayoutSchema.parse(slots)).toHaveLength(3);
    expect(() => FrameLayoutSchema.parse([...slots.slice(0, 2), slots[0]])).toThrow();
    expect(() => FrameLayoutSchema.parse([{ ...slots[0], x: 0.9 }, ...slots.slice(1)])).toThrow();
    expect(() =>
      FrameLayoutSchema.parse([...slots.slice(0, 2), { ...slots[2], slotIndex: 4 }]),
    ).toThrow();
  });

  it('allows any valid HTTPS URL without credentials or custom ports', () => {
    expect(isAllowedGoogleFormsUrl('https://forms.gle/abc123')).toBe(true);
    expect(isAllowedGoogleFormsUrl('https://docs.google.com/forms/d/e/example/viewform')).toBe(
      true,
    );
    expect(
      isAllowedGoogleFormsUrl('https://volunteer-management.ccf.org.ph/recruitment/form'),
    ).toBe(true);
    expect(isAllowedGoogleFormsUrl('https://custom.ministry.org/signup?ref=booth')).toBe(true);
    expect(isAllowedGoogleFormsUrl('https://example.org:443/form')).toBe(true);

    // Rejected cases
    expect(isAllowedGoogleFormsUrl('http://example.org/join')).toBe(false);
    expect(isAllowedGoogleFormsUrl('https://user:pass@example.org/join')).toBe(false);
    expect(isAllowedGoogleFormsUrl('https://example.org:8080/join')).toBe(false);
    expect(isAllowedGoogleFormsUrl(`https://example.org/${'a'.repeat(2050)}`)).toBe(false);

    expect(OptionalGoogleFormsUrlSchema.parse('')).toBeNull();
    expect(
      OptionalGoogleFormsUrlSchema.parse(
        'https://volunteer-management.ccf.org.ph/recruitment/form',
      ),
    ).toBe('https://volunteer-management.ccf.org.ph/recruitment/form');
    expect(() => OptionalGoogleFormsUrlSchema.parse('http://insecure.org')).toThrow();
  });

  it('validates QrStationState with the session-aware dismiss and recovery contracts', () => {
    expect(
      IpcContracts['qr-station:dismiss'].request.parse({
        sessionId: 'cda39163-9036-4acd-ae10-0c08fdb39022',
      }),
    ).toEqual({ sessionId: 'cda39163-9036-4acd-ae10-0c08fdb39022' });
    expect(IpcContracts['qr-station:dismiss'].request.parse({})).toEqual({});
    expect(
      IpcContracts['qr-station:retry-upload'].request.parse({
        sessionId: 'cda39163-9036-4acd-ae10-0c08fdb39022',
      }),
    ).toEqual({ sessionId: 'cda39163-9036-4acd-ae10-0c08fdb39022' });
    expect(
      IpcContracts['qr-station:finish-offline'].request.parse({
        sessionId: 'cda39163-9036-4acd-ae10-0c08fdb39022',
      }),
    ).toEqual({ sessionId: 'cda39163-9036-4acd-ae10-0c08fdb39022' });
    expect(
      IpcContracts['qr-station:get-state'].response.parse({
        ok: true,
        data: {
          status: 'active',
          sessionId: 'cda39163-9036-4acd-ae10-0c08fdb39022',
          collageUrl: 'grace-booth-media://asset/collage',
          qrImageUrl: 'data:image/png;base64,AA==',
          expiresAt: null,
          durationSeconds: 45,
          message: null,
          deliveryMode: 'offline',
        },
      }),
    ).toMatchObject({
      ok: true,
      data: {
        canRetryUpload: false,
        canFinishOffline: false,
        deliveryMode: 'offline',
      },
    });
  });

  it('enforces all four QrStationStateSchema variants and rejects illegal field combinations', () => {
    const sessionId = 'cda39163-9036-4acd-ae10-0c08fdb39022';

    const idle = QrStationStateSchema.parse({
      status: 'idle',
      sessionId: null,
      collageUrl: null,
      qrImageUrl: null,
      expiresAt: null,
      durationSeconds: 45,
      message: null,
      printStatus: null,
    });
    expect(idle).toMatchObject({
      status: 'idle',
      canRetryUpload: false,
      canFinishOffline: false,
    });
    expect(qrStationAllowsAutoDismiss(idle)).toBe(false);

    const preparing = QrStationStateSchema.parse({
      status: 'preparing',
      sessionId,
      collageUrl: null,
      qrImageUrl: null,
      expiresAt: null,
      durationSeconds: 45,
      message: 'Creating your collage…',
      printStatus: {
        phase: 'preparing',
        origin: 'session',
        pendingCopies: 2,
        totalCopies: 2,
      },
    });
    expect(preparing).toMatchObject({
      status: 'preparing',
      sessionId,
      collageUrl: null,
      qrImageUrl: null,
      expiresAt: null,
      canRetryUpload: false,
      canFinishOffline: false,
    });
    expect(qrStationAllowsAutoDismiss(preparing)).toBe(false);

    const preparingWithCollage = QrStationStateSchema.parse({
      ...preparing,
      collageUrl: 'grace-booth-media://asset/collage-1',
    });
    expect(preparingWithCollage.collageUrl).toBe('grace-booth-media://asset/collage-1');

    const active = QrStationStateSchema.parse({
      status: 'active',
      sessionId,
      collageUrl: 'grace-booth-media://asset/collage-1',
      qrImageUrl: 'data:image/png;base64,AA==',
      expiresAt: 120_000,
      durationSeconds: 45,
      message: null,
      deliveryMode: 'cloud',
      printStatus: null,
    });
    expect(qrStationAllowsAutoDismiss(active)).toBe(true);

    const error = QrStationStateSchema.parse({
      status: 'error',
      sessionId,
      collageUrl: null,
      qrImageUrl: null,
      expiresAt: 120_000,
      durationSeconds: 45,
      message: 'Upload failed.',
      canRetryUpload: true,
      canFinishOffline: true,
      printStatus: null,
    });
    expect(qrStationAllowsAutoDismiss(error)).toBe(true);

    expect(() => QrStationStateSchema.parse({ ...preparing, expiresAt: 120_000 })).toThrow();
    expect(() =>
      QrStationStateSchema.parse({ ...preparing, qrImageUrl: 'data:image/png;base64,AA==' }),
    ).toThrow();
    expect(() => QrStationStateSchema.parse({ ...preparing, canRetryUpload: true })).toThrow();
    expect(() => QrStationStateSchema.parse({ ...idle, expiresAt: 120_000 })).toThrow();
    expect(() =>
      QrStationStateSchema.parse({ ...idle, qrImageUrl: 'data:image/png;base64,AA==' }),
    ).toThrow();
    expect(() => QrStationStateSchema.parse({ ...idle, sessionId })).toThrow();
    expect(() => QrStationStateSchema.parse({ ...active, qrImageUrl: null })).toThrow();
    expect(() => QrStationStateSchema.parse({ ...active, canFinishOffline: true })).toThrow();
    expect(() =>
      QrStationStateSchema.parse({ ...error, qrImageUrl: 'data:image/png;base64,AA==' }),
    ).toThrow();
  });

  it('identifies active session print phases via isSessionPrintActive', () => {
    expect(isSessionPrintActive(null)).toBe(false);
    expect(isSessionPrintActive(undefined)).toBe(false);
    expect(
      isSessionPrintActive({
        phase: 'preparing',
        origin: 'session',
        pendingCopies: 1,
        totalCopies: 1,
      }),
    ).toBe(true);
    expect(
      isSessionPrintActive({
        phase: 'printing',
        origin: 'reprint',
        stage: 'active',
        printedCopies: 0,
        remainingCopies: 1,
        totalCopies: 1,
      }),
    ).toBe(true);
    expect(
      isSessionPrintActive({
        phase: 'paused',
        origin: 'session',
        reason: 'offline',
        detail: 'Printer offline.',
        printedCopies: 0,
        remainingCopies: 1,
        totalCopies: 1,
      }),
    ).toBe(false);
    expect(
      isSessionPrintActive({
        phase: 'needs_attention',
        origin: 'session',
        detail: 'Check tray.',
        printedCopies: 0,
        attentionCopies: 1,
        remainingCopies: 0,
        totalCopies: 1,
      }),
    ).toBe(false);
    expect(
      isSessionPrintActive({
        phase: 'completed',
        origin: 'session',
        totalCopies: 1,
        completedAt: 1_000,
      }),
    ).toBe(false);
    expect(
      isSessionPrintActive({
        phase: 'partial',
        origin: 'session',
        printedCopies: 1,
        failedCopies: 1,
        cancelledCopies: 0,
        totalCopies: 2,
        completedAt: 1_000,
      }),
    ).toBe(false);
    expect(
      isSessionPrintActive({
        phase: 'failed',
        origin: 'session',
        failedCopies: 1,
        cancelledCopies: 0,
        totalCopies: 1,
        detail: 'Spool failed.',
      }),
    ).toBe(false);
    expect(
      isSessionPrintActive({
        phase: 'cancelled',
        origin: 'session',
        totalCopies: 1,
      }),
    ).toBe(false);
  });

  it('accepts a trimmed Unicode recruitment label and rejects invalid button text', () => {
    expect(RecruitmentButtonTextSchema.parse('  Sumali sa ministeryo 🙌  ')).toBe(
      'Sumali sa ministeryo 🙌',
    );
    expect(() => RecruitmentButtonTextSchema.parse('   ')).toThrow();
    expect(() => RecruitmentButtonTextSchema.parse('first\nsecond')).toThrow();
    expect(() => RecruitmentButtonTextSchema.parse('x'.repeat(81))).toThrow();
  });

  it('rejects extra IPC payload fields and weak passcodes', () => {
    expect(() => IpcContracts['booth:start'].request.parse({ arbitrary: true })).toThrow();
    expect(() => IpcContracts['admin:login'].request.parse({ passcode: '7777' })).toThrow();
  });

  it('requires ready metadata with an HTTPS public page origin or local LAN HTTP', () => {
    const valid = {
      status: 'ready',
      readyAt: '2026-08-17T12:00:00.000Z',
      expiresAt: '2026-09-16T12:00:00.000Z',
      publicPageOrigin: 'https://photos.example.org',
      publicPath: '/photo',
    };
    expect(ConfirmUploadResponseSchema.parse(valid)).toEqual(valid);
    expect(
      ConfirmUploadResponseSchema.parse({ ...valid, publicPageOrigin: 'http://192.168.1.50:4310' })
        .publicPageOrigin,
    ).toBe('http://192.168.1.50:4310');
    expect(() =>
      ConfirmUploadResponseSchema.parse({ ...valid, publicPageOrigin: 'http://example.test' }),
    ).toThrow();
  });

  it('validates frame identifiers for accept-photos and the admin frame library', () => {
    const frameId = 'cda39163-9036-4acd-ae10-0c08fdb39022';
    // Printing is off unless the operator asks for it.
    expect(IpcContracts['booth:accept-photos'].request.parse({ frameId })).toEqual({
      frameId,
      print: null,
    });
    expect(
      IpcContracts['booth:accept-photos'].request.parse({ frameId, print: { copies: 4 } }),
    ).toEqual({ frameId, print: { copies: 4 } });
    expect(() =>
      IpcContracts['booth:accept-photos'].request.parse({ frameId, print: { copies: 0 } }),
    ).toThrow();
    expect(() => IpcContracts['booth:accept-photos'].request.parse({})).toThrow();
    expect(() =>
      IpcContracts['booth:accept-photos'].request.parse({ frameId: 'not-a-uuid' }),
    ).toThrow();

    expect(IpcContracts['admin:list-frames'].request.parse({})).toEqual({});
    expect(IpcContracts['admin:choose-frame'].request.parse({})).toEqual({});
    expect(
      IpcContracts['admin:add-frame'].request.parse({
        candidateId: frameId,
        name: 'Landscape frame',
        shotCount: 1,
      }),
    ).toMatchObject({ candidateId: frameId, shotCount: 1 });
    expect(() =>
      IpcContracts['admin:add-frame'].request.parse({
        candidateId: frameId,
        name: 'Too many',
        shotCount: 11,
      }),
    ).toThrow();
    expect(IpcContracts['admin:replace-frame-image'].request.parse({ frameId })).toEqual({
      frameId,
    });
    expect(
      IpcContracts['admin:update-frame-layout'].request.parse({
        frameId,
        name: 'New name',
        slots,
        expectedRevision: 3,
      }),
    ).toMatchObject({ frameId, expectedRevision: 3 });
    expect(IpcContracts['admin:delete-frame'].request.parse({ frameId })).toEqual({ frameId });
    expect(IpcContracts['admin:move-frame'].request.parse({ frameId, direction: 'up' })).toEqual({
      frameId,
      direction: 'up',
    });
    expect(() =>
      IpcContracts['admin:move-frame'].request.parse({ frameId, direction: 'sideways' }),
    ).toThrow();
  });

  it('validates recent-gallery limits and multi-slot photoCount up to MAX_FRAME_SLOTS', () => {
    expect(IpcContracts['gallery:get-recent'].request.parse({ limit: 5 })).toEqual({ limit: 5 });
    expect(() => IpcContracts['gallery:get-recent'].request.parse({ limit: 0 })).toThrow();
    expect(() => IpcContracts['gallery:get-recent'].request.parse({ limit: 51 })).toThrow();

    const baseMetadata = {
      capturedAt: 1_700_000_000_000,
      photoCount: 4,
      frameName: '4-Slot Frame',
      uploadStatus: 'uploaded' as const,
      cloudExpiresAt: null,
      printable: true,
    };
    expect(GalleryItemMetadataSchema.parse(baseMetadata).photoCount).toBe(4);
    expect(
      GalleryItemMetadataSchema.parse({ ...baseMetadata, photoCount: MAX_FRAME_SLOTS }).photoCount,
    ).toBe(10);
    expect(() =>
      GalleryItemMetadataSchema.parse({ ...baseMetadata, photoCount: MAX_FRAME_SLOTS + 1 }),
    ).toThrow();
  });

  it('validates capture settings defaults, bounds, and save inputs', () => {
    expect(CaptureSettingsSchema.parse({})).toEqual(DEFAULT_CAPTURE_SETTINGS);
    expect(CaptureSettingsSchema.parse({ countdownSeconds: 1, reviewMode: 'continuous' })).toEqual({
      countdownSeconds: 1,
      reviewMode: 'continuous',
    });
    expect(CaptureSettingsSchema.parse({ countdownSeconds: 30, reviewMode: 'per_shot' })).toEqual({
      countdownSeconds: 30,
      reviewMode: 'per_shot',
    });
    expect(() => CaptureSettingsSchema.parse({ countdownSeconds: 0 })).toThrow();
    expect(() => CaptureSettingsSchema.parse({ countdownSeconds: 31 })).toThrow();
    expect(() => CaptureSettingsSchema.parse({ countdownSeconds: 5.5 })).toThrow();
    expect(() => CaptureSettingsSchema.parse({ reviewMode: 'manual' })).toThrow();

    expect(
      SaveCaptureSettingsInputSchema.parse({
        countdownSeconds: 10,
        reviewMode: 'per_shot',
        expectedRevision: 2,
      }),
    ).toEqual({ countdownSeconds: 10, reviewMode: 'per_shot', expectedRevision: 2 });
    expect(() =>
      SaveCaptureSettingsInputSchema.parse({
        countdownSeconds: 10,
        reviewMode: 'per_shot',
        expectedRevision: -1,
      }),
    ).toThrow();
    expect(() =>
      SaveCaptureSettingsInputSchema.parse({
        countdownSeconds: 10,
        reviewMode: 'per_shot',
        expectedRevision: 0,
        extra: true,
      }),
    ).toThrow();
  });

  it('includes shot_review in session state, guest screens, guards, and IPC contracts', () => {
    expect(SessionStateSchema.parse('shot_review')).toBe('shot_review');
    expect(GuestScreenSchema.parse('shot_review')).toBe('shot_review');

    expect(isCancellableSessionState('countdown')).toBe(true);
    expect(isCancellableSessionState('capturing')).toBe(true);
    expect(isCancellableSessionState('shot_review')).toBe(true);
    expect(isCancellableSessionState('review')).toBe(true);
    expect(isCancellableSessionState('processing')).toBe(false);
    expect(isCancellableSessionState('final')).toBe(false);
    expect(isCancellableSessionState(null)).toBe(false);

    expect(isCaptureScreen('countdown')).toBe(true);
    expect(isCaptureScreen('capturing')).toBe(true);
    expect(isCaptureScreen('shot_review')).toBe(true);
    expect(isCaptureScreen('review')).toBe(false);
    expect(isCaptureScreen('attract')).toBe(false);

    expect(
      BoothControlsSchema.parse({
        canStart: false,
        canRetakeAll: false,
        canAcceptPhotos: false,
        canRetryUpload: false,
        canFinish: false,
      }),
    ).toMatchObject({ canAcceptShot: false, canRetakeShot: false, canFinishOffline: false });

    expect(IpcContracts['booth:accept-shot'].request.parse({ shotNumber: 1 })).toEqual({
      shotNumber: 1,
    });
    expect(IpcContracts['booth:accept-shot'].request.parse({ shotNumber: 10 })).toEqual({
      shotNumber: 10,
    });
    expect(() => IpcContracts['booth:accept-shot'].request.parse({ shotNumber: 0 })).toThrow();
    expect(() => IpcContracts['booth:accept-shot'].request.parse({ shotNumber: 11 })).toThrow();

    expect(IpcContracts['booth:retake-shot'].request.parse({ shotNumber: 4 })).toEqual({
      shotNumber: 4,
    });
    expect(() => IpcContracts['booth:retake-shot'].request.parse({ shotNumber: 0 })).toThrow();
    expect(() =>
      IpcContracts['booth:retake-shot'].request.parse({ shotNumber: 2, extra: true }),
    ).toThrow();

    expect(
      IpcContracts['admin:save-capture-settings'].request.parse({
        countdownSeconds: 6,
        reviewMode: 'continuous',
        expectedRevision: 3,
      }),
    ).toEqual({ countdownSeconds: 6, reviewMode: 'continuous', expectedRevision: 3 });
    expect(() =>
      IpcContracts['admin:save-capture-settings'].request.parse({
        countdownSeconds: 31,
        reviewMode: 'per_shot',
        expectedRevision: 0,
      }),
    ).toThrow();
  });
});
