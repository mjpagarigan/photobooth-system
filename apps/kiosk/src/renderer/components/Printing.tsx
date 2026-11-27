import { Button, Minus, Plus, Printer, Warning } from '@grace-booth/ui';
import { useCallback, useEffect, useState } from 'react';

import type {
  GraceBoothBridge,
  PrinterHealth,
  PrinterStatusKind,
  PrintJobState,
  PrintJobSummary,
} from '@grace-booth/shared';
import { MAX_COPIES_PER_REQUEST, OPEN_PRINT_STATES } from '@grace-booth/shared';

import { isPrinterReady } from '../hooks/usePrinterHealth';

const OPEN_PRINT_STATE_SET: ReadonlySet<PrintJobState> = new Set(OPEN_PRINT_STATES);

function getBridge(): GraceBoothBridge | null {
  return window.graceBooth ?? null;
}

const STATUS_TITLE: Record<PrinterStatusKind, string> = {
  unconfigured: 'No printer set up',
  ready: 'Printer ready',
  printing: 'Printing',
  offline: 'Printer offline',
  paper_out: 'Printer out of paper',
  error: 'Printer needs attention',
  unknown: 'Printer status unknown',
};

/**
 * Status pill shown on the operator screen and the guest-facing display. It stays hidden while
 * everything is fine, so it only appears when someone needs to look at the printer.
 */
export function PrinterIndicator({
  health,
  placement = 'corner',
}: {
  health: PrinterHealth | null;
  placement?: 'corner' | 'inline';
}) {
  if (!health) return null;
  const problem = !isPrinterReady(health) && health.status !== 'unconfigured';
  const waiting = health.queuedCount > 0;
  const attention = health.attentionCount > 0;
  if (!problem && !attention) return null;
  const parts = [STATUS_TITLE[health.status]];
  if (waiting)
    parts.push(`${health.queuedCount} ${health.queuedCount === 1 ? 'copy' : 'copies'} waiting`);
  if (attention)
    parts.push(`${health.attentionCount} need${health.attentionCount === 1 ? 's' : ''} a decision`);
  return (
    <div
      className={`printer-indicator printer-indicator--${placement}${problem ? ' is-problem' : ''}`}
      data-testid="printer-indicator"
      data-printer-status={health.status}
      role="status"
      aria-live="polite"
    >
      {problem ? <Warning aria-hidden="true" weight="bold" /> : <Printer aria-hidden="true" />}
      <span className="printer-indicator__title">{parts.join(' · ')}</span>
      {problem && health.message ? (
        <span className="printer-indicator__message">{health.message}</span>
      ) : null}
    </div>
  );
}

export function CopyStepper({
  value,
  onChange,
  disabled = false,
  label = 'Copies',
}: {
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  label?: string;
}) {
  const clamp = (next: number): number =>
    Math.max(1, Math.min(MAX_COPIES_PER_REQUEST, Math.round(next) || 1));
  return (
    <div className="copy-stepper" role="group" aria-label={label}>
      <span className="copy-stepper__label">{label}</span>
      <button
        type="button"
        className="copy-stepper__button"
        aria-label="Fewer copies"
        disabled={disabled || value <= 1}
        onClick={() => onChange(clamp(value - 1))}
      >
        <Minus aria-hidden="true" />
      </button>
      <input
        aria-label="Number of copies"
        className="copy-stepper__value"
        data-testid="copy-count"
        disabled={disabled}
        inputMode="numeric"
        min={1}
        max={MAX_COPIES_PER_REQUEST}
        onChange={(event) => onChange(clamp(Number(event.target.value)))}
        type="number"
        value={value}
      />
      <button
        type="button"
        className="copy-stepper__button"
        aria-label="More copies"
        disabled={disabled || value >= MAX_COPIES_PER_REQUEST}
        onClick={() => onChange(clamp(value + 1))}
      >
        <Plus aria-hidden="true" />
      </button>
    </div>
  );
}

/** Reprint a 4R photo from Recent photos. */
export function ReprintControl({
  sessionId,
  onDone,
}: {
  sessionId: string;
  onDone?: (message: string) => void;
}) {
  const [copies, setCopies] = useState(1);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const reprint = async () => {
    const bridge = getBridge();
    if (!bridge?.print) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await bridge.print.reprint(sessionId, copies);
      const text = result.ok
        ? `${copies} ${copies === 1 ? 'copy' : 'copies'} added to the print queue.`
        : result.error.message || 'The reprint could not be queued.';
      setMessage(text);
      if (result.ok) onDone?.(text);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="reprint-control" data-testid="reprint-control">
      <CopyStepper value={copies} onChange={setCopies} disabled={busy} />
      <Button
        icon={<Printer aria-hidden="true" />}
        loading={busy}
        onClick={() => void reprint()}
        variant="secondary"
        wide
      >
        Reprint
      </Button>
      {message ? (
        <p className="reprint-control__message" role="status">
          {message}
        </p>
      ) : null}
    </div>
  );
}

const JOB_LABEL: Record<PrintJobState, string> = {
  waiting_for_photo: 'Waiting for photo',
  queued: 'Waiting to print',
  submitting: 'Sending to printer',
  spooled: 'At the printer',
  printed: 'Printed',
  needs_attention: 'Did it print?',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

const KIND_LABEL: Record<PrintJobSummary['kind'], string> = {
  session: 'Session',
  reprint: 'Reprint',
  calibration: 'Calibration chart',
  color_test: 'Color test',
};

/** The operator's view of the print queue: waiting copies can be cancelled before they print. */
export function PrintQueuePanel({ health }: { health: PrinterHealth | null }) {
  const [jobs, setJobs] = useState<PrintJobSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const bridge = getBridge();
    if (!bridge?.print) return;
    const result = await bridge.print.listJobs();
    if (result.ok) {
      setJobs(result.data);
      setError(null);
    } else setError(result.error.message || 'The print queue could not be loaded.');
  }, []);

  // Reload whenever the queue counts or status move.
  const healthKey = health
    ? `${health.status}:${health.queuedCount}:${health.attentionCount}:${health.checkedAt}`
    : 'none';
  useEffect(() => {
    void load();
  }, [load, healthKey]);

  const act = async (jobId: string, action: 'cancel' | 'print_again' | 'printed') => {
    const bridge = getBridge();
    if (!bridge?.print) return;
    setBusyId(jobId);
    try {
      const result =
        action === 'cancel'
          ? await bridge.print.cancelJob(jobId)
          : await bridge.print.resolveJob(jobId, action);
      if (!result.ok) setError(result.error.message || 'That print job could not be changed.');
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const open = jobs.filter((job) => OPEN_PRINT_STATE_SET.has(job.state));
  const recent = jobs.filter((job) => !open.includes(job)).slice(0, 10);

  return (
    <section className="print-queue" aria-labelledby="print-queue-title" data-testid="print-queue">
      <header className="print-queue__header">
        <h2 id="print-queue-title">
          <Printer aria-hidden="true" /> Print queue
        </h2>
        <PrinterIndicator health={health} placement="inline" />
      </header>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      {open.length === 0 ? (
        <p className="print-queue__empty">Nothing is waiting to print.</p>
      ) : (
        <ul className="print-queue__list">
          {open.map((job) => (
            <li
              key={job.id}
              className={`print-queue__item print-queue__item--${job.state}`}
              data-testid="print-queue-item"
              data-state={job.state}
            >
              <div className="print-queue__meta">
                <span className="print-queue__kind">
                  {KIND_LABEL[job.kind]} · copy {job.copyIndex} of {job.copyCount}
                </span>
                <span className="print-queue__state">{JOB_LABEL[job.state]}</span>
                {job.state === 'needs_attention' && job.lastErrorMessage ? (
                  <span className="print-queue__note">{job.lastErrorMessage}</span>
                ) : null}
              </div>
              <div className="print-queue__actions">
                {job.state === 'needs_attention' ? (
                  <>
                    <Button
                      loading={busyId === job.id}
                      onClick={() => void act(job.id, 'print_again')}
                      variant="secondary"
                    >
                      Print again
                    </Button>
                    <Button
                      disabled={busyId === job.id}
                      onClick={() => void act(job.id, 'printed')}
                      variant="secondary"
                    >
                      It printed
                    </Button>
                  </>
                ) : null}
                {job.state !== 'submitting' ? (
                  <Button
                    aria-label={`Cancel ${KIND_LABEL[job.kind].toLowerCase()} copy ${job.copyIndex}`}
                    disabled={busyId === job.id}
                    onClick={() => void act(job.id, 'cancel')}
                    variant="subtle"
                  >
                    Cancel
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
      {recent.length > 0 ? (
        <details className="print-queue__recent">
          <summary>Recently finished ({recent.length})</summary>
          <ul className="print-queue__list">
            {recent.map((job) => (
              <li key={job.id} className={`print-queue__item print-queue__item--${job.state}`}>
                <div className="print-queue__meta">
                  <span className="print-queue__kind">
                    {KIND_LABEL[job.kind]} · copy {job.copyIndex} of {job.copyCount}
                  </span>
                  <span className="print-queue__state">{JOB_LABEL[job.state]}</span>
                </div>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
