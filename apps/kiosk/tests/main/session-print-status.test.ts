import { describe, expect, it } from 'vitest';

import {
  BoothSnapshotSchema,
  OPEN_PRINT_STATES,
  QrStationStateSchema,
  SessionPrintStatusSchema,
  type PrinterStatusKind,
  type SessionPrintStatus,
} from '@grace-booth/shared';

import {
  deriveSessionPrintStatus,
  isSameSessionPrintStatus,
  printerBlockerFromHealth,
  type SessionPrintBlocker,
  type SessionPrintJobRecord,
} from '../../src/main/print/session-print-status.js';

const NO_BLOCKER: SessionPrintBlocker | null = null;

function makeJob(overrides: Partial<SessionPrintJobRecord> = {}): SessionPrintJobRecord {
  return {
    requestId: 'req-1',
    kind: 'session',
    copyIndex: 1,
    copyCount: 1,
    state: 'queued',
    lastErrorMessage: null,
    createdAt: 1_000,
    updatedAt: 1_000,
    printedAt: null,
    ...overrides,
  };
}

describe('SessionPrintStatusSchema boundary invariants', () => {
  it('accepts valid payloads for every variant and rejects impossible copy counts', () => {
    const validVariants: SessionPrintStatus[] = [
      { phase: 'preparing', origin: 'session', pendingCopies: 2, totalCopies: 3 },
      {
        phase: 'printing',
        origin: 'session',
        stage: 'active',
        printedCopies: 1,
        remainingCopies: 2,
        totalCopies: 3,
      },
      {
        phase: 'paused',
        origin: 'reprint',
        reason: 'paper_out',
        detail: 'Printer is out of paper.',
        printedCopies: 0,
        remainingCopies: 2,
        totalCopies: 2,
      },
      {
        phase: 'needs_attention',
        origin: 'mixed',
        detail: 'Check the output tray.',
        printedCopies: 1,
        attentionCopies: 1,
        remainingCopies: 1,
        totalCopies: 3,
      },
      { phase: 'completed', origin: 'session', totalCopies: 2, completedAt: 5_000 },
      {
        phase: 'partial',
        origin: 'session',
        printedCopies: 1,
        failedCopies: 1,
        cancelledCopies: 1,
        totalCopies: 3,
        completedAt: 5_000,
      },
      {
        phase: 'failed',
        origin: 'session',
        failedCopies: 1,
        cancelledCopies: 1,
        totalCopies: 2,
        detail: 'The photo for this copy is no longer stored.',
      },
      { phase: 'cancelled', origin: 'reprint', totalCopies: 2 },
    ];

    for (const variant of validVariants) {
      expect(SessionPrintStatusSchema.parse(variant)).toEqual(variant);
    }

    expect(() =>
      SessionPrintStatusSchema.parse({
        phase: 'preparing',
        origin: 'session',
        pendingCopies: 4,
        totalCopies: 3,
      }),
    ).toThrow();

    expect(() =>
      SessionPrintStatusSchema.parse({
        phase: 'printing',
        origin: 'session',
        stage: 'queued',
        printedCopies: 2,
        remainingCopies: 2,
        totalCopies: 3,
      }),
    ).toThrow();

    expect(() =>
      SessionPrintStatusSchema.parse({
        phase: 'paused',
        origin: 'session',
        reason: 'offline',
        detail: '',
        printedCopies: 2,
        remainingCopies: 2,
        totalCopies: 3,
      }),
    ).toThrow();

    expect(() =>
      SessionPrintStatusSchema.parse({
        phase: 'needs_attention',
        origin: 'session',
        detail: '',
        printedCopies: 1,
        attentionCopies: 2,
        remainingCopies: 1,
        totalCopies: 3,
      }),
    ).toThrow();

    expect(() =>
      SessionPrintStatusSchema.parse({
        phase: 'partial',
        origin: 'session',
        printedCopies: 2,
        failedCopies: 0,
        cancelledCopies: 0,
        totalCopies: 2,
        completedAt: 5_000,
      }),
    ).toThrow();

    expect(() =>
      SessionPrintStatusSchema.parse({
        phase: 'partial',
        origin: 'session',
        printedCopies: 1,
        failedCopies: 0,
        cancelledCopies: 0,
        totalCopies: 1,
        completedAt: 5_000,
      }),
    ).toThrow();

    expect(() =>
      SessionPrintStatusSchema.parse({
        phase: 'failed',
        origin: 'session',
        failedCopies: 1,
        cancelledCopies: 0,
        totalCopies: 2,
        detail: '',
      }),
    ).toThrow();

    expect(() =>
      SessionPrintStatusSchema.parse({
        phase: 'completed',
        origin: 'session',
        totalCopies: 0,
        completedAt: 5_000,
      }),
    ).toThrow();
  });

  it('validates printStatus inside BoothSnapshotSchema and QrStationStateSchema', () => {
    const baseSnapshot = {
      screen: 'final' as const,
      state: 'final' as const,
      sessionId: 'cda39163-9036-4acd-ae10-0c08fdb39022',
      shotNumber: null,
      captureCount: 3,
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
        canFinish: true,
      },
      errorCode: null,
      message: null,
    };

    expect(BoothSnapshotSchema.parse(baseSnapshot).printStatus).toBeUndefined();
    expect(
      BoothSnapshotSchema.parse({ ...baseSnapshot, printStatus: null }).printStatus,
    ).toBeNull();
    expect(
      BoothSnapshotSchema.parse({
        ...baseSnapshot,
        printStatus: { phase: 'completed', origin: 'session', totalCopies: 1, completedAt: 2_000 },
      }).printStatus,
    ).toEqual({ phase: 'completed', origin: 'session', totalCopies: 1, completedAt: 2_000 });

    const baseQrState = {
      status: 'active' as const,
      sessionId: 'cda39163-9036-4acd-ae10-0c08fdb39022',
      collageUrl: null,
      qrImageUrl: null,
      expiresAt: 10_000,
      durationSeconds: 45,
      message: null,
    };

    expect(QrStationStateSchema.parse(baseQrState).printStatus).toBeUndefined();
    expect(
      QrStationStateSchema.parse({ ...baseQrState, printStatus: null }).printStatus,
    ).toBeNull();
    expect(
      QrStationStateSchema.parse({
        ...baseQrState,
        printStatus: {
          phase: 'printing',
          origin: 'session',
          stage: 'active',
          printedCopies: 0,
          remainingCopies: 1,
          totalCopies: 1,
        },
      }).printStatus?.phase,
    ).toBe('printing');
  });

  it('exports the five open print job states from shared', () => {
    expect(OPEN_PRINT_STATES).toEqual([
      'waiting_for_photo',
      'queued',
      'submitting',
      'spooled',
      'needs_attention',
    ]);
  });
});

describe('printerBlockerFromHealth', () => {
  it('maps every PrinterStatusKind exhaustively and returns null for ready and printing', () => {
    const expectedByStatus: Record<PrinterStatusKind, SessionPrintBlocker['reason'] | null> = {
      ready: null,
      printing: null,
      offline: 'offline',
      paper_out: 'paper_out',
      error: 'printer_error',
      unconfigured: 'printer_unconfigured',
      unknown: 'printer_unknown',
    };

    expect(printerBlockerFromHealth({ status: 'ready', message: 'Printer ready.' })).toBeNull();
    expect(
      printerBlockerFromHealth({ status: 'printing', message: 'Printing another job.' }),
    ).toBeNull();

    for (const [status, expectedReason] of Object.entries(expectedByStatus) as [
      PrinterStatusKind,
      SessionPrintBlocker['reason'] | null,
    ][]) {
      const blocker = printerBlockerFromHealth({
        status,
        message: `  Status is ${status}  `,
      });
      if (expectedReason === null) {
        expect(blocker).toBeNull();
      } else {
        expect(blocker).toEqual({
          reason: expectedReason,
          detail: `Status is ${status}`,
        });
      }
    }
  });

  it('trims and truncates health messages to 300 characters', () => {
    const longMessage = `  ${'x'.repeat(350)}  `;
    expect(printerBlockerFromHealth({ status: 'error', message: longMessage })).toEqual({
      reason: 'printer_error',
      detail: 'x'.repeat(300),
    });
  });
});

describe('deriveSessionPrintStatus', () => {
  it('returns null when a session has no session or reprint jobs', () => {
    expect(deriveSessionPrintStatus([], NO_BLOCKER)).toBeNull();
    expect(
      deriveSessionPrintStatus(
        [
          makeJob({ kind: 'calibration', state: 'queued' }),
          makeJob({ kind: 'color_test', state: 'printed', printedAt: 2_000 }),
        ],
        NO_BLOCKER,
      ),
    ).toBeNull();
  });

  it('returns preparing while copies wait for photo and photo_interrupted when session is interrupted', () => {
    const waitingJobs = [
      makeJob({ copyIndex: 1, copyCount: 3, state: 'waiting_for_photo' }),
      makeJob({ copyIndex: 2, copyCount: 3, state: 'waiting_for_photo' }),
      makeJob({ copyIndex: 3, copyCount: 3, state: 'cancelled' }),
    ];

    const preparing = deriveSessionPrintStatus(waitingJobs, NO_BLOCKER);
    expect(preparing).toEqual({
      phase: 'preparing',
      origin: 'session',
      pendingCopies: 2,
      totalCopies: 3,
    });
    expect(SessionPrintStatusSchema.parse(preparing)).toEqual(preparing);

    const interrupted = deriveSessionPrintStatus(waitingJobs, NO_BLOCKER, {
      sessionInterrupted: true,
    });
    expect(interrupted).toEqual({
      phase: 'paused',
      origin: 'session',
      reason: 'photo_interrupted',
      detail: 'Photo preparation was interrupted before printing started.',
      printedCopies: 0,
      remainingCopies: 2,
      totalCopies: 3,
    });
    expect(SessionPrintStatusSchema.parse(interrupted)).toEqual(interrupted);
  });

  it('detects active printing from job rows when no printer blocker is present', () => {
    const queuedStatus = deriveSessionPrintStatus(
      [
        makeJob({ state: 'queued', copyCount: 2, copyIndex: 1 }),
        makeJob({ state: 'queued', copyCount: 2, copyIndex: 2 }),
      ],
      NO_BLOCKER,
    );
    expect(queuedStatus).toEqual({
      phase: 'printing',
      origin: 'session',
      stage: 'queued',
      printedCopies: 0,
      remainingCopies: 2,
      totalCopies: 2,
    });

    const submittingStatus = deriveSessionPrintStatus(
      [makeJob({ state: 'submitting' })],
      NO_BLOCKER,
    );
    expect(submittingStatus).toEqual({
      phase: 'printing',
      origin: 'session',
      stage: 'active',
      printedCopies: 0,
      remainingCopies: 1,
      totalCopies: 1,
    });

    const spooledMultiCopy = deriveSessionPrintStatus(
      [
        makeJob({ copyIndex: 1, copyCount: 3, state: 'printed', printedAt: 2_000 }),
        makeJob({ copyIndex: 2, copyCount: 3, state: 'spooled', updatedAt: 2_500 }),
        makeJob({ copyIndex: 3, copyCount: 3, state: 'queued', updatedAt: 1_000 }),
      ],
      NO_BLOCKER,
    );
    expect(spooledMultiCopy).toEqual({
      phase: 'printing',
      origin: 'session',
      stage: 'active',
      printedCopies: 1,
      remainingCopies: 2,
      totalCopies: 3,
    });
    expect(SessionPrintStatusSchema.parse(spooledMultiCopy)).toEqual(spooledMultiCopy);
  });

  it('pauses active or queued jobs when a printer blocker is present and resumes when blocker is null', () => {
    const healthStatuses: readonly PrinterStatusKind[] = [
      'ready',
      'printing',
      'offline',
      'paper_out',
      'error',
      'unconfigured',
      'unknown',
    ];

    for (const status of healthStatuses) {
      const blocker = printerBlockerFromHealth({
        status,
        message: `Status is ${status}`,
      });
      const result = deriveSessionPrintStatus([makeJob({ state: 'spooled' })], blocker);
      if (blocker === null) {
        expect(result).toEqual({
          phase: 'printing',
          origin: 'session',
          stage: 'active',
          printedCopies: 0,
          remainingCopies: 1,
          totalCopies: 1,
        });
      } else {
        expect(result).toEqual({
          phase: 'paused',
          origin: 'session',
          reason: blocker.reason,
          detail: blocker.detail,
          printedCopies: 0,
          remainingCopies: 1,
          totalCopies: 1,
        });
      }
      expect(SessionPrintStatusSchema.parse(result)).toEqual(result);
    }
  });

  it('gives needs_attention priority over a printer blocker', () => {
    const status = deriveSessionPrintStatus(
      [
        makeJob({ copyIndex: 1, copyCount: 3, state: 'printed', printedAt: 2_000 }),
        makeJob({
          copyIndex: 2,
          copyCount: 3,
          state: 'needs_attention',
          lastErrorMessage: 'Check the output tray for copy 2.',
          updatedAt: 3_000,
        }),
        makeJob({ copyIndex: 3, copyCount: 3, state: 'queued', updatedAt: 1_000 }),
      ],
      { reason: 'offline', detail: 'Printer is offline.' },
    );

    expect(status).toEqual({
      phase: 'needs_attention',
      origin: 'session',
      detail: 'Check the output tray for copy 2.',
      printedCopies: 1,
      attentionCopies: 1,
      remainingCopies: 1,
      totalCopies: 3,
    });
    expect(SessionPrintStatusSchema.parse(status)).toEqual(status);
  });

  it('derives completed, partial, failed, and cancelled terminal outcomes accurately', () => {
    const completed = deriveSessionPrintStatus(
      [
        makeJob({
          copyIndex: 1,
          copyCount: 2,
          state: 'printed',
          printedAt: 3_000,
          updatedAt: 3_000,
        }),
        makeJob({
          copyIndex: 2,
          copyCount: 2,
          state: 'printed',
          printedAt: 4_500,
          updatedAt: 4_500,
        }),
      ],
      { reason: 'offline', detail: 'Offline after printing.' },
    );
    expect(completed).toEqual({
      phase: 'completed',
      origin: 'session',
      totalCopies: 2,
      completedAt: 4_500,
    });

    const partial = deriveSessionPrintStatus(
      [
        makeJob({
          copyIndex: 1,
          copyCount: 3,
          state: 'printed',
          printedAt: 3_000,
          updatedAt: 3_000,
        }),
        makeJob({
          copyIndex: 2,
          copyCount: 3,
          state: 'failed',
          lastErrorMessage: 'Missing source',
          updatedAt: 3_500,
        }),
        makeJob({ copyIndex: 3, copyCount: 3, state: 'cancelled', updatedAt: 4_000 }),
      ],
      NO_BLOCKER,
    );
    expect(partial).toEqual({
      phase: 'partial',
      origin: 'session',
      printedCopies: 1,
      failedCopies: 1,
      cancelledCopies: 1,
      totalCopies: 3,
      completedAt: 4_000,
    });

    const failed = deriveSessionPrintStatus(
      [
        makeJob({
          copyIndex: 1,
          copyCount: 2,
          state: 'failed',
          lastErrorMessage: 'Old error',
          updatedAt: 2_000,
        }),
        makeJob({ copyIndex: 2, copyCount: 2, state: 'cancelled', updatedAt: 2_500 }),
      ],
      NO_BLOCKER,
    );
    expect(failed).toEqual({
      phase: 'failed',
      origin: 'session',
      failedCopies: 1,
      cancelledCopies: 1,
      totalCopies: 2,
      detail: 'Old error',
    });

    const cancelled = deriveSessionPrintStatus(
      [
        makeJob({ copyIndex: 1, copyCount: 2, state: 'cancelled' }),
        makeJob({ copyIndex: 2, copyCount: 2, state: 'cancelled' }),
      ],
      NO_BLOCKER,
    );
    expect(cancelled).toEqual({
      phase: 'cancelled',
      origin: 'session',
      totalCopies: 2,
    });

    for (const status of [completed, partial, failed, cancelled]) {
      expect(SessionPrintStatusSchema.parse(status)).toEqual(status);
    }
  });

  it('scopes concurrent open requests together and lets newer reprints supersede older terminal attempts', () => {
    const concurrentMixed = deriveSessionPrintStatus(
      [
        makeJob({
          requestId: 'req-1',
          kind: 'session',
          copyIndex: 1,
          copyCount: 2,
          state: 'printed',
          printedAt: 2_000,
        }),
        makeJob({
          requestId: 'req-1',
          kind: 'session',
          copyIndex: 2,
          copyCount: 2,
          state: 'spooled',
          updatedAt: 2_500,
        }),
        makeJob({
          requestId: 'req-2',
          kind: 'reprint',
          copyIndex: 1,
          copyCount: 1,
          state: 'queued',
          createdAt: 3_000,
        }),
      ],
      NO_BLOCKER,
    );
    expect(concurrentMixed).toEqual({
      phase: 'printing',
      origin: 'mixed',
      stage: 'active',
      printedCopies: 1,
      remainingCopies: 2,
      totalCopies: 3,
    });

    const openReprintAfterCompletedSession = deriveSessionPrintStatus(
      [
        makeJob({
          requestId: 'req-1',
          kind: 'session',
          copyIndex: 1,
          copyCount: 2,
          state: 'printed',
          createdAt: 1_000,
          printedAt: 1_500,
        }),
        makeJob({
          requestId: 'req-1',
          kind: 'session',
          copyIndex: 2,
          copyCount: 2,
          state: 'printed',
          createdAt: 1_000,
          printedAt: 1_600,
        }),
        makeJob({
          requestId: 'req-2',
          kind: 'reprint',
          copyIndex: 1,
          copyCount: 1,
          state: 'queued',
          createdAt: 5_000,
        }),
      ],
      NO_BLOCKER,
    );
    expect(openReprintAfterCompletedSession).toEqual({
      phase: 'printing',
      origin: 'reprint',
      stage: 'queued',
      printedCopies: 0,
      remainingCopies: 1,
      totalCopies: 1,
    });

    const completedReprintAfterFailedSession = deriveSessionPrintStatus(
      [
        makeJob({
          requestId: 'req-1',
          kind: 'session',
          state: 'failed',
          lastErrorMessage: 'Failed earlier',
          createdAt: 1_000,
          updatedAt: 2_000,
        }),
        makeJob({
          requestId: 'req-2',
          kind: 'reprint',
          state: 'printed',
          createdAt: 5_000,
          updatedAt: 6_000,
          printedAt: 6_000,
        }),
      ],
      NO_BLOCKER,
    );
    expect(completedReprintAfterFailedSession).toEqual({
      phase: 'completed',
      origin: 'reprint',
      totalCopies: 1,
      completedAt: 6_000,
    });

    const tieBreakByUpdatedAtAndRequestId = deriveSessionPrintStatus(
      [
        makeJob({
          requestId: 'req-a',
          kind: 'session',
          state: 'cancelled',
          createdAt: 1_000,
          updatedAt: 2_000,
        }),
        makeJob({
          requestId: 'req-b',
          kind: 'reprint',
          state: 'printed',
          createdAt: 1_000,
          updatedAt: 2_000,
          printedAt: 2_000,
        }),
      ],
      NO_BLOCKER,
    );
    expect(tieBreakByUpdatedAtAndRequestId).toEqual({
      phase: 'completed',
      origin: 'reprint',
      totalCopies: 1,
      completedAt: 2_000,
    });
  });
});

describe('isSameSessionPrintStatus', () => {
  it('treats null and undefined as equal and detects differences in every variant field', () => {
    expect(isSameSessionPrintStatus(null, null)).toBe(true);
    expect(isSameSessionPrintStatus(null, undefined)).toBe(true);
    expect(isSameSessionPrintStatus(undefined, null)).toBe(true);

    const printingQueued: SessionPrintStatus = {
      phase: 'printing',
      origin: 'session',
      stage: 'queued',
      printedCopies: 0,
      remainingCopies: 2,
      totalCopies: 2,
    };
    const printingActive: SessionPrintStatus = {
      ...printingQueued,
      stage: 'active',
    };
    expect(isSameSessionPrintStatus(printingQueued, { ...printingQueued })).toBe(true);
    expect(isSameSessionPrintStatus(printingQueued, printingActive)).toBe(false);
    expect(isSameSessionPrintStatus(printingQueued, null)).toBe(false);
    expect(isSameSessionPrintStatus(printingQueued, { ...printingQueued, origin: 'reprint' })).toBe(
      false,
    );

    const pausedOffline: SessionPrintStatus = {
      phase: 'paused',
      origin: 'session',
      reason: 'offline',
      detail: 'Printer is offline.',
      printedCopies: 0,
      remainingCopies: 1,
      totalCopies: 1,
    };
    expect(isSameSessionPrintStatus(pausedOffline, { ...pausedOffline })).toBe(true);
    expect(isSameSessionPrintStatus(pausedOffline, { ...pausedOffline, reason: 'paper_out' })).toBe(
      false,
    );
    expect(
      isSameSessionPrintStatus(pausedOffline, { ...pausedOffline, detail: 'Different detail' }),
    ).toBe(false);

    const completed: SessionPrintStatus = {
      phase: 'completed',
      origin: 'session',
      totalCopies: 1,
      completedAt: 3_000,
    };
    expect(isSameSessionPrintStatus(completed, { ...completed })).toBe(true);
    expect(isSameSessionPrintStatus(completed, { ...completed, completedAt: 3_001 })).toBe(false);
  });
});
