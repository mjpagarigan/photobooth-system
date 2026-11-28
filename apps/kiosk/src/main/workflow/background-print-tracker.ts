import type { SessionPrintStatus } from '@grace-booth/shared';

import type { SessionPrintChangeEvent } from '../print/session-print-status.js';

export const BACKGROUND_PRINT_CLEAR_MS = 10_000;

export type SessionPrintReader = (sessionId: string) => SessionPrintStatus | null;

export function shouldAutoClearBackgroundPrint(status: SessionPrintStatus): boolean {
  switch (status.phase) {
    case 'preparing':
    case 'printing':
    case 'needs_attention':
      return false;
    case 'paused':
      return status.reason === 'photo_interrupted';
    case 'completed':
    case 'partial':
    case 'failed':
    case 'cancelled':
      return true;
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}

export class BackgroundPrintTracker {
  private sessionId: string | null = null;
  private clearTimer: ReturnType<typeof setTimeout> | null = null;
  private timerArmedForSessionId: string | null = null;

  constructor(
    private readonly onExpired: () => void,
    private readonly lingerMs: number = BACKGROUND_PRINT_CLEAR_MS,
  ) {}

  currentSessionId(): string | null {
    return this.sessionId;
  }

  handlesEvent(event: SessionPrintChangeEvent): boolean {
    if (!this.sessionId) return false;
    return event.scope === 'health' || event.sessionId === this.sessionId;
  }

  track(sessionId: string): void {
    this.cancelTimer();
    this.sessionId = sessionId;
  }

  onNonPrintHandoff(readStatus: SessionPrintReader): void {
    if (!this.sessionId) return;
    const status = readStatus(this.sessionId);
    if (!status || shouldAutoClearBackgroundPrint(status)) {
      this.clear();
    }
  }

  peekStatus(readStatus: SessionPrintReader): SessionPrintStatus | null {
    return this.sessionId ? readStatus(this.sessionId) : null;
  }

  reconcile(readStatus: SessionPrintReader): SessionPrintStatus | null {
    if (!this.sessionId) return null;
    const trackedId = this.sessionId;
    const status = readStatus(trackedId);
    if (!status) {
      this.clear();
      return null;
    }
    if (shouldAutoClearBackgroundPrint(status)) {
      if (this.timerArmedForSessionId !== trackedId) {
        this.cancelTimer();
        this.timerArmedForSessionId = trackedId;
        this.clearTimer = setTimeout(() => {
          if (this.sessionId !== trackedId) return;
          this.clear();
          this.onExpired();
        }, this.lingerMs);
        this.clearTimer.unref();
      }
    } else {
      this.cancelTimer();
    }
    return status;
  }

  clear(): void {
    this.cancelTimer();
    this.sessionId = null;
  }

  private cancelTimer(): void {
    if (this.clearTimer) {
      clearTimeout(this.clearTimer);
      this.clearTimer = null;
    }
    this.timerArmedForSessionId = null;
  }
}
