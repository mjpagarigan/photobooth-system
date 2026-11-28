import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SessionPrintStatus } from '@grace-booth/shared';

import {
  BACKGROUND_PRINT_CLEAR_MS,
  BackgroundPrintTracker,
  shouldAutoClearBackgroundPrint,
} from '../../src/main/workflow/background-print-tracker.js';

const PREPARING: SessionPrintStatus = {
  phase: 'preparing',
  origin: 'session',
  pendingCopies: 2,
  totalCopies: 2,
};

const PRINTING: SessionPrintStatus = {
  phase: 'printing',
  origin: 'session',
  stage: 'active',
  printedCopies: 0,
  remainingCopies: 2,
  totalCopies: 2,
};

const PAUSED_OFFLINE: SessionPrintStatus = {
  phase: 'paused',
  origin: 'session',
  reason: 'offline',
  detail: 'Printer is offline.',
  printedCopies: 0,
  remainingCopies: 1,
  totalCopies: 1,
};

const PAUSED_PHOTO_INTERRUPTED: SessionPrintStatus = {
  phase: 'paused',
  origin: 'session',
  reason: 'photo_interrupted',
  detail: 'Photo preparation was interrupted before printing started.',
  printedCopies: 0,
  remainingCopies: 1,
  totalCopies: 1,
};

const NEEDS_ATTENTION: SessionPrintStatus = {
  phase: 'needs_attention',
  origin: 'session',
  detail: 'Check the output tray.',
  printedCopies: 0,
  attentionCopies: 1,
  remainingCopies: 0,
  totalCopies: 1,
};

const COMPLETED: SessionPrintStatus = {
  phase: 'completed',
  origin: 'session',
  totalCopies: 2,
  completedAt: 5_000,
};

const PARTIAL: SessionPrintStatus = {
  phase: 'partial',
  origin: 'session',
  printedCopies: 1,
  failedCopies: 1,
  cancelledCopies: 0,
  totalCopies: 2,
  completedAt: 5_000,
};

const FAILED: SessionPrintStatus = {
  phase: 'failed',
  origin: 'session',
  failedCopies: 1,
  cancelledCopies: 0,
  totalCopies: 1,
  detail: 'Spooler rejected job.',
};

const CANCELLED: SessionPrintStatus = {
  phase: 'cancelled',
  origin: 'session',
  totalCopies: 1,
};

describe('shouldAutoClearBackgroundPrint', () => {
  it('pins active, hardware-paused, and needs_attention statuses and auto-clears finished or photo_interrupted statuses', () => {
    expect(shouldAutoClearBackgroundPrint(PREPARING)).toBe(false);
    expect(shouldAutoClearBackgroundPrint(PRINTING)).toBe(false);
    expect(shouldAutoClearBackgroundPrint(NEEDS_ATTENTION)).toBe(false);

    for (const reason of [
      'offline',
      'paper_out',
      'printer_error',
      'printer_unconfigured',
      'printer_unknown',
    ] as const) {
      expect(
        shouldAutoClearBackgroundPrint({
          ...PAUSED_OFFLINE,
          reason,
        }),
      ).toBe(false);
    }

    expect(shouldAutoClearBackgroundPrint(PAUSED_PHOTO_INTERRUPTED)).toBe(true);
    expect(shouldAutoClearBackgroundPrint(COMPLETED)).toBe(true);
    expect(shouldAutoClearBackgroundPrint(PARTIAL)).toBe(true);
    expect(shouldAutoClearBackgroundPrint(FAILED)).toBe(true);
    expect(shouldAutoClearBackgroundPrint(CANCELLED)).toBe(true);
  });
});

describe('BackgroundPrintTracker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('tracks matching session and health events and keeps non-terminal phases pinned', () => {
    const onExpired = vi.fn();
    const tracker = new BackgroundPrintTracker(onExpired);
    const statuses = new Map<string, SessionPrintStatus>([['session-a', PREPARING]]);
    const read = (id: string) => statuses.get(id) ?? null;

    expect(tracker.currentSessionId()).toBeNull();
    expect(tracker.handlesEvent({ scope: 'health' })).toBe(false);
    expect(tracker.peekStatus(read)).toBeNull();

    tracker.track('session-a');
    expect(tracker.currentSessionId()).toBe('session-a');
    expect(tracker.handlesEvent({ scope: 'health' })).toBe(true);
    expect(tracker.handlesEvent({ scope: 'session', sessionId: 'session-a' })).toBe(true);
    expect(tracker.handlesEvent({ scope: 'session', sessionId: 'session-b' })).toBe(false);
    expect(tracker.peekStatus(read)).toEqual(PREPARING);

    for (const pinned of [PREPARING, PRINTING, PAUSED_OFFLINE, NEEDS_ATTENTION]) {
      statuses.set('session-a', pinned);
      expect(tracker.reconcile(read)).toEqual(pinned);
      vi.advanceTimersByTime(BACKGROUND_PRINT_CLEAR_MS * 3);
      expect(tracker.currentSessionId()).toBe('session-a');
      expect(onExpired).not.toHaveBeenCalled();
    }
  });

  it('arms the clear timer once across repeated health ticks and clears cleanly on expiry', () => {
    const onExpired = vi.fn();
    const tracker = new BackgroundPrintTracker(onExpired);
    let status: SessionPrintStatus | null = COMPLETED;
    const read = () => status;

    tracker.track('session-a');
    expect(tracker.reconcile(read)).toEqual(COMPLETED);

    vi.advanceTimersByTime(6_000);
    expect(tracker.reconcile(read)).toEqual(COMPLETED);

    vi.advanceTimersByTime(3_999);
    expect(tracker.currentSessionId()).toBe('session-a');
    expect(onExpired).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(tracker.currentSessionId()).toBeNull();
    expect(tracker.peekStatus(read)).toBeNull();
    expect(onExpired).toHaveBeenCalledTimes(1);

    status = PAUSED_PHOTO_INTERRUPTED;
    tracker.track('session-b');
    expect(tracker.reconcile(read)).toEqual(PAUSED_PHOTO_INTERRUPTED);
    vi.advanceTimersByTime(BACKGROUND_PRINT_CLEAR_MS);
    expect(tracker.currentSessionId()).toBeNull();
    expect(onExpired).toHaveBeenCalledTimes(2);
  });

  it('cancels the linger timer when a tracked session is reprinted and re-arms on completion', () => {
    const onExpired = vi.fn();
    const tracker = new BackgroundPrintTracker(onExpired);
    let status: SessionPrintStatus = COMPLETED;
    const read = () => status;

    tracker.track('session-a');
    tracker.reconcile(read);
    vi.advanceTimersByTime(7_000);

    status = { ...PRINTING, origin: 'reprint' };
    expect(tracker.reconcile(read)).toEqual(status);

    vi.advanceTimersByTime(BACKGROUND_PRINT_CLEAR_MS * 2);
    expect(tracker.currentSessionId()).toBe('session-a');
    expect(onExpired).not.toHaveBeenCalled();

    status = { ...COMPLETED, origin: 'reprint', completedAt: 9_000 };
    expect(tracker.reconcile(read)).toEqual(status);

    vi.advanceTimersByTime(BACKGROUND_PRINT_CLEAR_MS - 1);
    expect(tracker.currentSessionId()).toBe('session-a');
    vi.advanceTimersByTime(1);
    expect(tracker.currentSessionId()).toBeNull();
    expect(onExpired).toHaveBeenCalledTimes(1);
  });

  it('preserves active or hardware-paused sessions on non-print handoff and clears terminal ones', () => {
    const onExpired = vi.fn();
    const tracker = new BackgroundPrintTracker(onExpired);
    let status: SessionPrintStatus | null = PRINTING;
    const read = () => status;

    tracker.track('session-a');
    tracker.onNonPrintHandoff(read);
    expect(tracker.currentSessionId()).toBe('session-a');

    status = PAUSED_OFFLINE;
    tracker.onNonPrintHandoff(read);
    expect(tracker.currentSessionId()).toBe('session-a');

    status = COMPLETED;
    tracker.reconcile(read);
    tracker.onNonPrintHandoff(read);
    expect(tracker.currentSessionId()).toBeNull();

    vi.advanceTimersByTime(BACKGROUND_PRINT_CLEAR_MS * 2);
    expect(onExpired).not.toHaveBeenCalled();
  });

  it('switches immediately to the newest tracked print session and cancels prior timers', () => {
    const onExpired = vi.fn();
    const tracker = new BackgroundPrintTracker(onExpired);
    const statuses = new Map<string, SessionPrintStatus>([
      ['session-a', COMPLETED],
      ['session-b', PREPARING],
    ]);
    const read = (id: string) => statuses.get(id) ?? null;

    tracker.track('session-a');
    tracker.reconcile(read);
    vi.advanceTimersByTime(5_000);

    tracker.track('session-b');
    expect(tracker.currentSessionId()).toBe('session-b');
    expect(tracker.peekStatus(read)).toEqual(PREPARING);

    vi.advanceTimersByTime(BACKGROUND_PRINT_CLEAR_MS * 2);
    expect(tracker.currentSessionId()).toBe('session-b');
    expect(onExpired).not.toHaveBeenCalled();

    tracker.clear();
    expect(tracker.currentSessionId()).toBeNull();
    expect(tracker.reconcile(read)).toBeNull();
  });

  it('clears tracking when readStatus returns null during reconcile', () => {
    const onExpired = vi.fn();
    const tracker = new BackgroundPrintTracker(onExpired);
    tracker.track('session-a');

    expect(tracker.reconcile(() => null)).toBeNull();
    expect(tracker.currentSessionId()).toBeNull();
    expect(onExpired).not.toHaveBeenCalled();
  });
});
