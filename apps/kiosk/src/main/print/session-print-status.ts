import {
  OPEN_PRINT_STATES,
  type PrinterStatusKind,
  type PrintJobKind,
  type PrintJobState,
  type SessionPrintOrigin,
  type SessionPrintPauseReason,
  type SessionPrintStatus,
} from '@grace-booth/shared';

export type SessionPrintJobRecord = {
  readonly requestId: string;
  readonly kind: PrintJobKind;
  readonly copyIndex: number;
  readonly copyCount: number;
  readonly state: PrintJobState;
  readonly lastErrorMessage: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly printedAt: number | null;
};

export type SessionPrintHealthInput = {
  readonly status: PrinterStatusKind;
  readonly message: string;
};

export type SessionPrintBlocker = {
  readonly reason: Exclude<SessionPrintPauseReason, 'photo_interrupted'>;
  readonly detail: string;
};

export type SessionPrintDeriveOptions = {
  readonly sessionInterrupted?: boolean;
};

export type SessionPrintChangeEvent =
  | { readonly scope: 'session'; readonly sessionId: string }
  | { readonly scope: 'health' };

const OPEN_STATE_SET: ReadonlySet<PrintJobState> = new Set(OPEN_PRINT_STATES);
const MAX_DETAIL_LENGTH = 300;
const PHOTO_INTERRUPTED_DETAIL = 'Photo preparation was interrupted before printing started.';

export function printerBlockerFromHealth(
  health: SessionPrintHealthInput,
): SessionPrintBlocker | null {
  let reason: SessionPrintBlocker['reason'];
  switch (health.status) {
    case 'ready':
    case 'printing':
      return null;
    case 'offline':
      reason = 'offline';
      break;
    case 'paper_out':
      reason = 'paper_out';
      break;
    case 'error':
      reason = 'printer_error';
      break;
    case 'unconfigured':
      reason = 'printer_unconfigured';
      break;
    case 'unknown':
      reason = 'printer_unknown';
      break;
    default: {
      const exhaustive: never = health.status;
      return exhaustive;
    }
  }
  return {
    reason,
    detail: health.message.trim().slice(0, MAX_DETAIL_LENGTH),
  };
}

function computeOrigin(jobs: readonly SessionPrintJobRecord[]): SessionPrintOrigin {
  let hasSession = false;
  let hasReprint = false;
  for (const job of jobs) {
    if (job.kind === 'session') hasSession = true;
    else if (job.kind === 'reprint') hasReprint = true;
  }
  if (hasSession && hasReprint) return 'mixed';
  return hasReprint ? 'reprint' : 'session';
}

function latestErrorDetail(
  jobs: readonly SessionPrintJobRecord[],
  state: 'needs_attention' | 'failed',
): string {
  let latest: SessionPrintJobRecord | null = null;
  for (const job of jobs) {
    if (job.state !== state) continue;
    const message = job.lastErrorMessage?.trim();
    if (!message) continue;
    if (
      !latest ||
      job.updatedAt > latest.updatedAt ||
      (job.updatedAt === latest.updatedAt && job.copyIndex > latest.copyIndex)
    ) {
      latest = job;
    }
  }
  return latest?.lastErrorMessage?.trim().slice(0, MAX_DETAIL_LENGTH) ?? '';
}

function latestCompletionTimestamp(jobs: readonly SessionPrintJobRecord[]): number {
  let latest = 0;
  for (const job of jobs) {
    const timestamp = job.printedAt ?? job.updatedAt;
    if (timestamp > latest) latest = timestamp;
  }
  return latest;
}

type RequestGroup = {
  readonly requestId: string;
  readonly jobs: SessionPrintJobRecord[];
  hasOpen: boolean;
  maxCreatedAt: number;
  maxUpdatedAt: number;
};

function selectScopedJobs(jobs: readonly SessionPrintJobRecord[]): SessionPrintJobRecord[] {
  const groups = new Map<string, RequestGroup>();
  for (const job of jobs) {
    let group = groups.get(job.requestId);
    if (!group) {
      group = {
        requestId: job.requestId,
        jobs: [],
        hasOpen: false,
        maxCreatedAt: job.createdAt,
        maxUpdatedAt: job.updatedAt,
      };
      groups.set(job.requestId, group);
    }
    group.jobs.push(job);
    if (OPEN_STATE_SET.has(job.state)) group.hasOpen = true;
    if (job.createdAt > group.maxCreatedAt) group.maxCreatedAt = job.createdAt;
    if (job.updatedAt > group.maxUpdatedAt) group.maxUpdatedAt = job.updatedAt;
  }

  const openJobs: SessionPrintJobRecord[] = [];
  let newestTerminal: RequestGroup | null = null;

  for (const group of groups.values()) {
    if (group.hasOpen) {
      openJobs.push(...group.jobs);
      continue;
    }
    if (
      !newestTerminal ||
      group.maxCreatedAt > newestTerminal.maxCreatedAt ||
      (group.maxCreatedAt === newestTerminal.maxCreatedAt &&
        group.maxUpdatedAt > newestTerminal.maxUpdatedAt) ||
      (group.maxCreatedAt === newestTerminal.maxCreatedAt &&
        group.maxUpdatedAt === newestTerminal.maxUpdatedAt &&
        group.requestId > newestTerminal.requestId)
    ) {
      newestTerminal = group;
    }
  }

  if (openJobs.length > 0) return openJobs;
  return newestTerminal?.jobs ?? [];
}

export function deriveSessionPrintStatus(
  jobs: readonly SessionPrintJobRecord[],
  blocker: SessionPrintBlocker | null,
  options: SessionPrintDeriveOptions = {},
): SessionPrintStatus | null {
  const sessionJobs = jobs.filter((job) => job.kind === 'session' || job.kind === 'reprint');
  if (sessionJobs.length === 0) return null;

  const scopedJobs = selectScopedJobs(sessionJobs);
  if (scopedJobs.length === 0) return null;

  const origin = computeOrigin(scopedJobs);
  const totalCopies = scopedJobs.length;

  let waiting = 0;
  let queued = 0;
  let active = 0;
  let attention = 0;
  let printed = 0;
  let failed = 0;
  let cancelled = 0;

  for (const job of scopedJobs) {
    switch (job.state) {
      case 'waiting_for_photo':
        waiting += 1;
        break;
      case 'queued':
        queued += 1;
        break;
      case 'submitting':
      case 'spooled':
        active += 1;
        break;
      case 'needs_attention':
        attention += 1;
        break;
      case 'printed':
        printed += 1;
        break;
      case 'failed':
        failed += 1;
        break;
      case 'cancelled':
        cancelled += 1;
        break;
      default: {
        const exhaustive: never = job.state;
        return exhaustive;
      }
    }
  }

  if (attention > 0) {
    return {
      phase: 'needs_attention',
      origin,
      detail: latestErrorDetail(scopedJobs, 'needs_attention'),
      printedCopies: printed,
      attentionCopies: attention,
      remainingCopies: waiting + queued + active,
      totalCopies,
    };
  }

  if (waiting > 0 && queued === 0 && active === 0) {
    if (options.sessionInterrupted) {
      return {
        phase: 'paused',
        origin,
        reason: 'photo_interrupted',
        detail: PHOTO_INTERRUPTED_DETAIL,
        printedCopies: printed,
        remainingCopies: waiting,
        totalCopies,
      };
    }
    return {
      phase: 'preparing',
      origin,
      pendingCopies: waiting,
      totalCopies,
    };
  }

  if (queued + active > 0) {
    if (blocker !== null) {
      return {
        phase: 'paused',
        origin,
        reason: blocker.reason,
        detail: blocker.detail,
        printedCopies: printed,
        remainingCopies: waiting + queued + active,
        totalCopies,
      };
    }
    return {
      phase: 'printing',
      origin,
      stage: active > 0 ? 'active' : 'queued',
      printedCopies: printed,
      remainingCopies: waiting + queued + active,
      totalCopies,
    };
  }

  if (printed === totalCopies) {
    return {
      phase: 'completed',
      origin,
      totalCopies,
      completedAt: latestCompletionTimestamp(scopedJobs),
    };
  }

  if (printed > 0) {
    return {
      phase: 'partial',
      origin,
      printedCopies: printed,
      failedCopies: failed,
      cancelledCopies: cancelled,
      totalCopies,
      completedAt: latestCompletionTimestamp(scopedJobs),
    };
  }

  if (failed > 0) {
    return {
      phase: 'failed',
      origin,
      failedCopies: failed,
      cancelledCopies: cancelled,
      totalCopies,
      detail: latestErrorDetail(scopedJobs, 'failed'),
    };
  }

  return {
    phase: 'cancelled',
    origin,
    totalCopies,
  };
}

export function isSameSessionPrintStatus(
  left: SessionPrintStatus | null | undefined,
  right: SessionPrintStatus | null | undefined,
): boolean {
  const a = left ?? null;
  const b = right ?? null;
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (a.origin !== b.origin) return false;

  switch (a.phase) {
    case 'preparing':
      return (
        b.phase === 'preparing' &&
        a.pendingCopies === b.pendingCopies &&
        a.totalCopies === b.totalCopies
      );
    case 'printing':
      return (
        b.phase === 'printing' &&
        a.stage === b.stage &&
        a.printedCopies === b.printedCopies &&
        a.remainingCopies === b.remainingCopies &&
        a.totalCopies === b.totalCopies
      );
    case 'paused':
      return (
        b.phase === 'paused' &&
        a.reason === b.reason &&
        a.detail === b.detail &&
        a.printedCopies === b.printedCopies &&
        a.remainingCopies === b.remainingCopies &&
        a.totalCopies === b.totalCopies
      );
    case 'needs_attention':
      return (
        b.phase === 'needs_attention' &&
        a.detail === b.detail &&
        a.printedCopies === b.printedCopies &&
        a.attentionCopies === b.attentionCopies &&
        a.remainingCopies === b.remainingCopies &&
        a.totalCopies === b.totalCopies
      );
    case 'completed':
      return (
        b.phase === 'completed' &&
        a.totalCopies === b.totalCopies &&
        a.completedAt === b.completedAt
      );
    case 'partial':
      return (
        b.phase === 'partial' &&
        a.printedCopies === b.printedCopies &&
        a.failedCopies === b.failedCopies &&
        a.cancelledCopies === b.cancelledCopies &&
        a.totalCopies === b.totalCopies &&
        a.completedAt === b.completedAt
      );
    case 'failed':
      return (
        b.phase === 'failed' &&
        a.failedCopies === b.failedCopies &&
        a.cancelledCopies === b.cancelledCopies &&
        a.totalCopies === b.totalCopies &&
        a.detail === b.detail
      );
    case 'cancelled':
      return b.phase === 'cancelled' && a.totalCopies === b.totalCopies;
    default: {
      const exhaustive: never = a;
      return exhaustive;
    }
  }
}
