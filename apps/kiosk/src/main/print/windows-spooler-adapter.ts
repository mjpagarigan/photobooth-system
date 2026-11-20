import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';

import {
  PrinterCapabilitiesSchema,
  PrinterStatusKindSchema,
  PrinterSummarySchema,
  type PrinterCapabilities,
  type PrinterSummary,
} from '@grace-booth/shared';
import { z } from 'zod';

import { AppError } from '../errors.js';
import type {
  PrinterAdapter,
  PrinterQueueStatus,
  SpoolerJobProbe,
  SubmitPrintInput,
  SubmitPrintResult,
} from './printer-adapter.js';
import { PrintNotSubmittedError } from './printer-adapter.js';

const QUERY_TIMEOUT_MS = 30_000;
const SUBMIT_TIMEOUT_MS = 180_000;
/** Helper errors raised before PrintDocument.Print() — the spooler never saw the document. */
const NOT_SUBMITTED_CODES = new Set(['printer_missing', 'paper_missing', 'print_image_missing']);

const ResponseSchema = z.union([
  z.object({ id: z.number().int(), ok: z.literal(true), data: z.unknown() }),
  z.object({
    id: z.number().int().nullable(),
    ok: z.literal(false),
    code: z.string(),
    message: z.string(),
  }),
]);

const StatusSchema = z.object({ status: PrinterStatusKindSchema, message: z.string() });
const ProbeSchema = z.union([
  z.object({ found: z.literal(false) }),
  z.object({
    found: z.literal(true),
    spoolerJobId: z.number().int(),
    printed: z.boolean(),
    problem: z.enum(['paper_out', 'offline', 'error']).nullable(),
    statusText: z.string(),
  }),
]);
const SubmitSchema = z.object({ spoolerJobId: z.number().int().nullable() });

class HelperError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

type Pending = {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
};

/**
 * Talks to the Windows spooler through a long-lived PowerShell helper (.NET PrintDocument plus
 * the spooler's CIM classes). Works with any installed printer, USB or network.
 */
export class WindowsSpoolerAdapter implements PrinterAdapter {
  readonly kind = 'windows' as const;
  private child: ChildProcessWithoutNullStreams | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private closed = false;

  constructor(
    private readonly helperScriptPath: string,
    private readonly platform: NodeJS.Platform = process.platform,
  ) {}

  async listPrinters(): Promise<PrinterSummary[]> {
    return z.array(PrinterSummarySchema).parse(asArray(await this.call('list', {})));
  }

  async getCapabilities(printerName: string): Promise<PrinterCapabilities> {
    const data = (await this.call('capabilities', { printerName })) as Record<string, unknown>;
    return PrinterCapabilitiesSchema.parse({
      ...data,
      paperCandidates: asArray(data.paperCandidates),
    });
  }

  async getStatus(printerName: string): Promise<PrinterQueueStatus> {
    try {
      return StatusSchema.parse(await this.call('status', { printerName }));
    } catch (error) {
      if (error instanceof HelperError && error.code === 'printer_missing') {
        return { status: 'offline', message: 'The chosen printer is no longer installed.' };
      }
      throw error;
    }
  }

  async submit(input: SubmitPrintInput): Promise<SubmitPrintResult> {
    try {
      return SubmitSchema.parse(await this.call('submit', input, SUBMIT_TIMEOUT_MS));
    } catch (error) {
      if (error instanceof HelperError && NOT_SUBMITTED_CODES.has(error.code)) {
        throw new PrintNotSubmittedError(error.code, error.message);
      }
      throw error;
    }
  }

  async findJob(printerName: string, documentKey: string): Promise<SpoolerJobProbe> {
    return ProbeSchema.parse(await this.call('findJob', { printerName, documentKey }));
  }

  async cancel(printerName: string, documentKey: string): Promise<void> {
    await this.call('cancel', { printerName, documentKey });
  }

  close(): Promise<void> {
    this.closed = true;
    this.child?.stdin.end();
    this.child?.kill();
    this.child = null;
    this.rejectAll(new AppError('printer_helper_closed', 'The printer helper stopped.'));
    return Promise.resolve();
  }

  private call(
    op: string,
    args: Record<string, unknown>,
    timeoutMs = QUERY_TIMEOUT_MS,
  ): Promise<unknown> {
    if (this.closed) {
      return Promise.reject(new AppError('printer_helper_closed', 'The printer helper stopped.'));
    }
    if (this.platform !== 'win32') {
      return Promise.reject(
        new AppError('printer_unsupported', 'Printing is only available on Windows.'),
      );
    }
    const child = this.ensureChild();
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        // A hung helper cannot be trusted with the next request; start a fresh one.
        this.restart();
        reject(new HelperError('printer_helper_timeout', 'The printer did not answer in time.'));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      child.stdin.write(`${JSON.stringify({ id, op, ...args })}\n`);
    });
  }

  private ensureChild(): ChildProcessWithoutNullStreams {
    if (this.child) return this.child;
    const child = spawn(
      'powershell.exe',
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        this.helperScriptPath,
      ],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    createInterface({ input: child.stdout }).on('line', (line) => this.handleLine(line));
    child.on('exit', () => {
      if (this.child === child) this.child = null;
      this.rejectAll(new AppError('printer_helper_exited', 'The printer helper stopped.'));
    });
    child.on('error', () => {
      if (this.child === child) this.child = null;
      this.rejectAll(new AppError('printer_helper_failed', 'The printer helper could not start.'));
    });
    this.child = child;
    return child;
  }

  private handleLine(line: string): void {
    let parsed: z.infer<typeof ResponseSchema>;
    try {
      parsed = ResponseSchema.parse(JSON.parse(line));
    } catch {
      return;
    }
    if (parsed.id === null) return;
    const entry = this.pending.get(parsed.id);
    if (!entry) return;
    this.pending.delete(parsed.id);
    clearTimeout(entry.timer);
    if (parsed.ok) entry.resolve(parsed.data);
    else entry.reject(new HelperError(parsed.code, parsed.message));
  }

  private restart(): void {
    const child = this.child;
    this.child = null;
    child?.kill();
  }

  private rejectAll(error: Error): void {
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(error);
      this.pending.delete(id);
    }
  }
}

/** PowerShell's ConvertTo-Json collapses one-element arrays and turns empty ones into null. */
function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  return value === null || value === undefined ? [] : [value];
}
