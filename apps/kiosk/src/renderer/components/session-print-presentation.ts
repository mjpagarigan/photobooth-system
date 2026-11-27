import type { SessionPrintPauseReason, SessionPrintStatus } from '@grace-booth/shared';

import { safeGuestMessage } from '../types';

export type SessionPrintTone = 'light' | 'dark';
export type SessionPrintVisualState = 'progress' | 'success' | 'warning' | 'danger' | 'neutral';
export type SessionPrintIconKind = 'spinner' | 'check' | 'warning' | 'warning-circle' | 'printer';

export type SessionPrintPresentation = {
  readonly visualState: SessionPrintVisualState;
  readonly icon: SessionPrintIconKind;
  readonly label: string;
  readonly detail: string | null;
};

function copyWord(count: number): string {
  return count === 1 ? 'copy' : 'copies';
}

function pauseReasonText(reason: SessionPrintPauseReason, detail: string): string {
  switch (reason) {
    case 'offline':
      return 'Printer offline';
    case 'paper_out':
      return 'Out of paper';
    case 'printer_unconfigured':
      return 'No printer set up';
    case 'photo_interrupted':
      return 'Waiting for photo recovery';
    case 'printer_error':
      return safeGuestMessage(detail || null, 'Printer needs attention');
    case 'printer_unknown':
      return safeGuestMessage(detail || null, 'Checking printer status');
    default: {
      const exhaustive: never = reason;
      return exhaustive;
    }
  }
}

export function describeSessionPrintStatus(status: SessionPrintStatus): SessionPrintPresentation {
  const isReprint = status.origin === 'reprint';

  switch (status.phase) {
    case 'preparing':
      return {
        visualState: 'progress',
        icon: 'spinner',
        label: isReprint
          ? status.pendingCopies === 1
            ? 'Preparing reprint'
            : `Preparing ${status.pendingCopies} reprint copies`
          : status.pendingCopies === 1
            ? 'Preparing to print'
            : `Preparing ${status.pendingCopies} copies`,
        detail: 'Starts once your photo is ready',
      };

    case 'printing': {
      if (status.stage === 'queued' && status.printedCopies === 0) {
        const base = isReprint ? 'Waiting to reprint' : 'Waiting to print';
        return {
          visualState: 'progress',
          icon: 'spinner',
          label:
            status.remainingCopies === 1
              ? base
              : `${base} · ${status.remainingCopies} ${copyWord(status.remainingCopies)}`,
          detail: 'In the print queue',
        };
      }
      const activeTotal = status.printedCopies + status.remainingCopies;
      const currentCopy = Math.min(activeTotal, status.printedCopies + 1);
      if (activeTotal === 1) {
        return {
          visualState: 'progress',
          icon: 'spinner',
          label: isReprint ? 'Reprinting photo…' : 'Printing photo…',
          detail: null,
        };
      }
      return {
        visualState: 'progress',
        icon: 'spinner',
        label: isReprint
          ? `Reprinting copy ${currentCopy} of ${activeTotal}…`
          : `Printing copy ${currentCopy} of ${activeTotal}…`,
        detail: status.printedCopies > 0 ? `${status.printedCopies} finished` : null,
      };
    }

    case 'paused': {
      const reasonText = pauseReasonText(status.reason, status.detail);
      const detail =
        status.reason === 'photo_interrupted'
          ? reasonText
          : `${reasonText} · ${status.remainingCopies} ${copyWord(status.remainingCopies)} waiting`;
      return {
        visualState: 'warning',
        icon: 'warning',
        label: isReprint ? 'Reprint paused' : 'Printing paused',
        detail,
      };
    }

    case 'needs_attention':
      return {
        visualState: 'warning',
        icon: 'warning',
        label: 'Check the print tray',
        detail:
          status.attentionCopies === 1
            ? '1 copy needs an operator check in Print queue.'
            : `${status.attentionCopies} copies need an operator check in Print queue.`,
      };

    case 'completed': {
      const base = isReprint ? 'Reprint finished' : 'Print finished';
      return {
        visualState: 'success',
        icon: 'check',
        label: status.totalCopies === 1 ? base : `${base} · ${status.totalCopies} copies`,
        detail: 'Sent to the printer. Collect from the print tray.',
      };
    }

    case 'partial': {
      const parts: string[] = [];
      if (status.failedCopies > 0) parts.push(`${status.failedCopies} failed`);
      if (status.cancelledCopies > 0) parts.push(`${status.cancelledCopies} cancelled`);
      return {
        visualState: 'warning',
        icon: 'warning',
        label: isReprint
          ? `${status.printedCopies} of ${status.totalCopies} reprint copies printed`
          : `${status.printedCopies} of ${status.totalCopies} copies printed`,
        detail: parts.length > 0 ? parts.join(' · ') : null,
      };
    }

    case 'failed':
      return {
        visualState: 'danger',
        icon: 'warning-circle',
        label: isReprint ? 'Reprint didn’t finish' : 'Print didn’t finish',
        detail: safeGuestMessage(
          status.detail || null,
          'Ask a booth volunteer to check the printer.',
        ),
      };

    case 'cancelled':
      return {
        visualState: 'neutral',
        icon: 'printer',
        label: isReprint ? 'Reprint cancelled' : 'Print cancelled',
        detail: status.totalCopies > 1 ? `${status.totalCopies} copies cancelled` : null,
      };

    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}
