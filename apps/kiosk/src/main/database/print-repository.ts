import { randomUUID } from 'node:crypto';

import {
  OPEN_PRINT_STATES,
  PrintJobKindSchema,
  PrintJobStateSchema,
  type PrinterAdapterKind,
  type PrinterSettings,
  type PrintJobKind,
  type PrintJobState,
  type PrintJobSummary,
} from '@grace-booth/shared';

import { AppError } from '../errors.js';
import type { BoothDatabase } from './database.js';

export { OPEN_PRINT_STATES };

export type StoredPrinterSettings = PrinterSettings & {
  iccProfilePath: string | null;
  updatedAt: number;
};

export type StoredPrintJob = {
  id: string;
  requestId: string;
  sessionId: string | null;
  sourceAssetId: string | null;
  kind: PrintJobKind;
  copyIndex: number;
  copyCount: number;
  state: PrintJobState;
  documentKey: string;
  printerName: string | null;
  paperRawKind: number | null;
  paperName: string | null;
  spoolerJobId: number | null;
  attemptCount: number;
  submittedAt: number | null;
  printedAt: number | null;
  cancelledAt: number | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  createdAt: number;
  updatedAt: number;
};

const CANCELLABLE_STATES: readonly PrintJobState[] = [
  'waiting_for_photo',
  'queued',
  'spooled',
  'needs_attention',
];

const JOB_SELECT = `
  SELECT id, request_id, session_id, source_asset_id, kind, copy_index, copy_count, state,
    document_key, printer_name, paper_raw_kind, paper_name, spooler_job_id, attempt_count,
    submitted_at, printed_at, cancelled_at, last_error_code, last_error_message,
    created_at, updated_at
  FROM print_jobs
`;

export function documentKeyFor(jobId: string): string {
  return `GraceBooth-${jobId}`;
}

export function printJobSummary(job: StoredPrintJob): PrintJobSummary {
  return {
    id: job.id,
    requestId: job.requestId,
    sessionId: job.sessionId,
    kind: job.kind,
    copyIndex: job.copyIndex,
    copyCount: job.copyCount,
    state: job.state,
    printerName: job.printerName,
    lastErrorCode: job.lastErrorCode,
    lastErrorMessage: job.lastErrorMessage,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    printedAt: job.printedAt,
  };
}

export class PrintRepository {
  constructor(private readonly database: BoothDatabase) {}

  getPrinterSettings(): StoredPrinterSettings {
    const row = this.database.raw
      .prepare(
        `SELECT adapter, printer_name, paper_raw_kind, paper_name, timeout_seconds,
          icc_profile_path, icc_profile_name, revision, updated_at
        FROM printer_settings WHERE id = 1`,
      )
      .get() as Record<string, unknown> | undefined;
    if (!row) throw new AppError('printer_settings_missing', 'Printer settings are missing.');
    return {
      adapter: row.adapter === 'mock' ? 'mock' : 'windows',
      printerName: (row.printer_name as string | null) ?? null,
      paperRawKind: (row.paper_raw_kind as number | null) ?? null,
      paperName: (row.paper_name as string | null) ?? null,
      timeoutSeconds: row.timeout_seconds as number,
      iccProfilePath: (row.icc_profile_path as string | null) ?? null,
      iccProfileName: (row.icc_profile_name as string | null) ?? null,
      revision: row.revision as number,
      updatedAt: row.updated_at as number,
    };
  }

  updatePrinterSettings(
    input: {
      printerName: string | null;
      paperRawKind: number | null;
      paperName: string | null;
      timeoutSeconds: number;
      expectedRevision: number;
    },
    now = Date.now(),
  ): StoredPrinterSettings {
    const result = this.database.raw
      .prepare(
        `UPDATE printer_settings SET printer_name = ?, paper_raw_kind = ?, paper_name = ?,
          timeout_seconds = ?, revision = revision + 1, updated_at = ?
        WHERE id = 1 AND revision = ?`,
      )
      .run(
        input.printerName,
        input.paperRawKind,
        input.paperName,
        input.timeoutSeconds,
        now,
        input.expectedRevision,
      );
    if (result.changes !== 1) {
      throw new AppError(
        'printer_settings_conflict',
        'Printer settings changed elsewhere. Reload and try again.',
      );
    }
    this.recordAudit('printer_settings_change', null, now);
    return this.getPrinterSettings();
  }

  setIccProfile(path: string | null, name: string | null, now = Date.now()): StoredPrinterSettings {
    this.database.raw
      .prepare(
        `UPDATE printer_settings SET icc_profile_path = ?, icc_profile_name = ?,
          revision = revision + 1, updated_at = ? WHERE id = 1`,
      )
      .run(path, name, now);
    this.recordAudit('printer_settings_change', path ? 'icc_set' : 'icc_cleared', now);
    return this.getPrinterSettings();
  }

  setAdapter(adapter: PrinterAdapterKind, now = Date.now()): StoredPrinterSettings {
    this.database.raw
      .prepare('UPDATE printer_settings SET adapter = ?, updated_at = ? WHERE id = 1')
      .run(adapter, now);
    return this.getPrinterSettings();
  }

  /** Creates one row per copy. Session copies wait for the finished photo before queuing. */
  createRequest(
    input: {
      kind: PrintJobKind;
      sessionId: string | null;
      sourceAssetId: string | null;
      copies: number;
    },
    now = Date.now(),
  ): StoredPrintJob[] {
    if (!Number.isSafeInteger(input.copies) || input.copies < 1) {
      throw new AppError('print_copies_invalid', 'Choose at least one copy.');
    }
    const requestId = randomUUID();
    const state: PrintJobState =
      input.kind === 'session' && input.sourceAssetId === null ? 'waiting_for_photo' : 'queued';
    const insert = this.database.raw.prepare(
      `INSERT INTO print_jobs (id, request_id, session_id, source_asset_id, kind, copy_index,
        copy_count, state, document_key, attempt_count, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    );
    const ids: string[] = [];
    this.database.raw.transaction(() => {
      for (let copy = 1; copy <= input.copies; copy += 1) {
        const id = randomUUID();
        ids.push(id);
        insert.run(
          id,
          requestId,
          input.sessionId,
          input.sourceAssetId,
          input.kind,
          copy,
          input.copies,
          state,
          documentKeyFor(id),
          now,
          now,
        );
      }
      if (input.kind === 'reprint') this.recordAudit('reprint', null, now);
      if (input.kind === 'calibration' || input.kind === 'color_test') {
        this.recordAudit('print_test', input.kind, now);
      }
    })();
    return ids.map((id) => this.requireJob(id));
  }

  /** Moves a session's waiting copies onto the queue once its finished photo exists. */
  attachSessionPhoto(sessionId: string, assetId: string, now = Date.now()): number {
    return this.database.raw
      .prepare(
        `UPDATE print_jobs SET source_asset_id = ?, state = 'queued', updated_at = ?
        WHERE session_id = ? AND kind = 'session' AND state = 'waiting_for_photo'`,
      )
      .run(assetId, now, sessionId).changes;
  }

  listJobsForSession(sessionId: string): StoredPrintJob[] {
    return this.database.raw
      .prepare(
        `${JOB_SELECT} WHERE session_id = ?
        ORDER BY created_at, request_id, copy_index`,
      )
      .all(sessionId)
      .map((row) => mapJob(row as Record<string, unknown>));
  }

  discardWaitingForSession(sessionId: string): number {
    return this.database.raw
      .prepare(
        `DELETE FROM print_jobs
        WHERE session_id = ? AND kind = 'session' AND state = 'waiting_for_photo'`,
      )
      .run(sessionId).changes;
  }

  listWaitingSessionIds(): string[] {
    return (
      this.database.raw
        .prepare(
          `SELECT DISTINCT session_id FROM print_jobs
          WHERE state = 'waiting_for_photo' AND session_id IS NOT NULL`,
        )
        .all() as { session_id: string }[]
    ).map((row) => row.session_id);
  }

  getJob(jobId: string): StoredPrintJob | null {
    const row = this.database.raw.prepare(`${JOB_SELECT} WHERE id = ?`).get(jobId);
    return row ? mapJob(row as Record<string, unknown>) : null;
  }

  requireJob(jobId: string): StoredPrintJob {
    const job = this.getJob(jobId);
    if (!job) throw new AppError('print_job_missing', 'That print job no longer exists.');
    return job;
  }

  /** Open copies first (oldest first), then the most recent finished ones. */
  listJobsForOperator(recentLimit = 30): StoredPrintJob[] {
    const open = this.database.raw
      .prepare(
        `${JOB_SELECT} WHERE state IN (${placeholders(OPEN_PRINT_STATES)})
        ORDER BY created_at, request_id, copy_index`,
      )
      .all(...OPEN_PRINT_STATES);
    const finished = this.database.raw
      .prepare(
        `${JOB_SELECT} WHERE state NOT IN (${placeholders(OPEN_PRINT_STATES)})
        ORDER BY updated_at DESC LIMIT ?`,
      )
      .all(...OPEN_PRINT_STATES, recentLimit);
    return [...open, ...finished].map((row) => mapJob(row as Record<string, unknown>));
  }

  listJobsInState(states: readonly PrintJobState[]): StoredPrintJob[] {
    return this.database.raw
      .prepare(
        `${JOB_SELECT} WHERE state IN (${placeholders(states)})
        ORDER BY created_at, request_id, copy_index`,
      )
      .all(...states)
      .map((row) => mapJob(row as Record<string, unknown>));
  }

  nextQueuedJob(): StoredPrintJob | null {
    const row = this.database.raw
      .prepare(
        `${JOB_SELECT} WHERE state = 'queued' ORDER BY created_at, request_id, copy_index LIMIT 1`,
      )
      .get();
    return row ? mapJob(row as Record<string, unknown>) : null;
  }

  countOpen(): { queued: number; attention: number } {
    const row = this.database.raw
      .prepare(
        `SELECT
          SUM(CASE WHEN state IN ('waiting_for_photo', 'queued', 'submitting', 'spooled')
            THEN 1 ELSE 0 END) AS queued,
          SUM(CASE WHEN state = 'needs_attention' THEN 1 ELSE 0 END) AS attention
        FROM print_jobs`,
      )
      .get() as { queued: number | null; attention: number | null };
    return { queued: row.queued ?? 0, attention: row.attention ?? 0 };
  }

  /** queued -> submitting. Written before the spooler is called so a crash is detectable. */
  beginSubmit(
    jobId: string,
    target: { printerName: string; paperRawKind: number | null; paperName: string | null },
    now = Date.now(),
  ): StoredPrintJob {
    const result = this.database.raw
      .prepare(
        `UPDATE print_jobs SET state = 'submitting', printer_name = ?, paper_raw_kind = ?,
          paper_name = ?, attempt_count = attempt_count + 1, submitted_at = ?,
          last_error_code = NULL, last_error_message = NULL, updated_at = ?
        WHERE id = ? AND state = 'queued'`,
      )
      .run(target.printerName, target.paperRawKind, target.paperName, now, now, jobId);
    if (result.changes !== 1) {
      throw new AppError('print_job_conflict', 'That print job is no longer waiting to print.');
    }
    return this.requireJob(jobId);
  }

  markSpooled(jobId: string, spoolerJobId: number | null, now = Date.now()): StoredPrintJob {
    this.transitionJob(jobId, ['submitting', 'spooled'], 'spooled', now, {
      spooler_job_id: spoolerJobId,
    });
    return this.requireJob(jobId);
  }

  markPrinted(jobId: string, now = Date.now()): StoredPrintJob {
    this.transitionJob(jobId, ['submitting', 'spooled', 'needs_attention'], 'printed', now, {
      printed_at: now,
      last_error_code: null,
      last_error_message: null,
    });
    return this.requireJob(jobId);
  }

  markNeedsAttention(
    jobId: string,
    code: string,
    message: string,
    now = Date.now(),
  ): StoredPrintJob {
    this.transitionJob(jobId, ['submitting', 'spooled'], 'needs_attention', now, {
      last_error_code: code.slice(0, 80),
      last_error_message: message.slice(0, 300),
    });
    return this.requireJob(jobId);
  }

  /** submitting -> queued, only when the spooler provably never accepted the document. */
  returnToQueue(jobId: string, code: string, message: string, now = Date.now()): StoredPrintJob {
    this.transitionJob(jobId, ['submitting'], 'queued', now, {
      spooler_job_id: null,
      last_error_code: code.slice(0, 80),
      last_error_message: message.slice(0, 300),
    });
    return this.requireJob(jobId);
  }

  markFailed(jobId: string, code: string, message: string, now = Date.now()): StoredPrintJob {
    this.transitionJob(jobId, ['waiting_for_photo', 'queued', 'submitting'], 'failed', now, {
      last_error_code: code.slice(0, 80),
      last_error_message: message.slice(0, 300),
    });
    return this.requireJob(jobId);
  }

  cancel(jobId: string, now = Date.now()): StoredPrintJob {
    const job = this.requireJob(jobId);
    if (!CANCELLABLE_STATES.includes(job.state)) {
      throw new AppError('print_job_conflict', 'That print job can no longer be cancelled.');
    }
    this.transitionJob(jobId, CANCELLABLE_STATES, 'cancelled', now, { cancelled_at: now });
    this.recordAudit('print_cancel', job.state, now);
    return this.requireJob(jobId);
  }

  resolve(jobId: string, resolution: 'print_again' | 'printed', now = Date.now()): StoredPrintJob {
    const job = this.requireJob(jobId);
    if (job.state !== 'needs_attention') {
      throw new AppError('print_job_conflict', 'That print job does not need a decision.');
    }
    if (resolution === 'printed') {
      this.transitionJob(jobId, ['needs_attention'], 'printed', now, {
        printed_at: now,
        last_error_code: null,
        last_error_message: null,
      });
    } else {
      this.transitionJob(jobId, ['needs_attention'], 'queued', now, {
        spooler_job_id: null,
        last_error_code: null,
        last_error_message: null,
      });
    }
    this.recordAudit('print_resolve', resolution, now);
    return this.requireJob(jobId);
  }

  private transitionJob(
    jobId: string,
    from: readonly PrintJobState[],
    to: PrintJobState,
    now: number,
    fields: Record<string, string | number | null>,
  ): void {
    const columns = Object.keys(fields);
    const assignments = columns.map((column) => `${column} = ?`).join(', ');
    const result = this.database.raw
      .prepare(
        `UPDATE print_jobs SET state = ?, ${assignments}${assignments ? ', ' : ''}updated_at = ?
        WHERE id = ? AND state IN (${placeholders(from)})`,
      )
      .run(to, ...columns.map((column) => fields[column] ?? null), now, jobId, ...from);
    if (result.changes !== 1) {
      throw new AppError('print_job_conflict', 'That print job changed state. Refresh the queue.');
    }
  }

  private recordAudit(
    operation:
      | 'printer_settings_change'
      | 'print_cancel'
      | 'print_resolve'
      | 'reprint'
      | 'print_test',
    detailCode: string | null,
    now: number,
  ): void {
    this.database.raw
      .prepare(
        `INSERT INTO audit_log (operation, outcome, detail_code, created_at)
        VALUES (?, 'success', ?, ?)`,
      )
      .run(operation, detailCode, now);
  }
}

function placeholders(values: readonly unknown[]): string {
  return values.map(() => '?').join(', ');
}

function mapJob(row: Record<string, unknown>): StoredPrintJob {
  return {
    id: row.id as string,
    requestId: row.request_id as string,
    sessionId: (row.session_id as string | null) ?? null,
    sourceAssetId: (row.source_asset_id as string | null) ?? null,
    kind: PrintJobKindSchema.parse(row.kind),
    copyIndex: row.copy_index as number,
    copyCount: row.copy_count as number,
    state: PrintJobStateSchema.parse(row.state),
    documentKey: row.document_key as string,
    printerName: (row.printer_name as string | null) ?? null,
    paperRawKind: (row.paper_raw_kind as number | null) ?? null,
    paperName: (row.paper_name as string | null) ?? null,
    spoolerJobId: (row.spooler_job_id as number | null) ?? null,
    attemptCount: row.attempt_count as number,
    submittedAt: (row.submitted_at as number | null) ?? null,
    printedAt: (row.printed_at as number | null) ?? null,
    cancelledAt: (row.cancelled_at as number | null) ?? null,
    lastErrorCode: (row.last_error_code as string | null) ?? null,
    lastErrorMessage: (row.last_error_message as string | null) ?? null,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
  };
}
