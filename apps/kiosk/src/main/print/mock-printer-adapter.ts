import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import type { PrinterCapabilities, PrinterStatusKind, PrinterSummary } from '@grace-booth/shared';

import type {
  PrinterAdapter,
  PrinterQueueStatus,
  SpoolerJobProbe,
  SubmitPrintInput,
  SubmitPrintResult,
} from './printer-adapter.js';
import { PrintNotSubmittedError } from './printer-adapter.js';

export const MOCK_PRINTER_NAME = 'Grace Booth Test Printer';

type MockJob = { spoolerJobId: number; documentKey: string; remainingMs: number };

export type MockPrinterOptions = {
  /** Where printed pages are copied, so tests can inspect them. Null keeps nothing. */
  outputDirectory: string | null;
  /** How long a page takes to print once the printer is ready. */
  printDurationMs?: number;
  initialStatus?: PrinterStatusKind;
};

/**
 * A scriptable printer for tests and development. Pages wait while it is offline or out of
 * paper and finish once it is ready again, the way a real Windows spooler holds jobs.
 */
export class MockPrinterAdapter implements PrinterAdapter {
  readonly kind = 'mock' as const;
  private status: PrinterStatusKind;
  private nextJobId = 1;
  private readonly jobs: MockJob[] = [];
  private readonly printedKeys = new Set<string>();
  private failNextSubmit: 'not_submitted' | 'unknown' | null = null;
  private timer: NodeJS.Timeout | null = null;
  readonly printed: string[] = [];

  constructor(private readonly options: MockPrinterOptions) {
    this.status = options.initialStatus ?? 'ready';
    if (options.outputDirectory) mkdirSync(options.outputDirectory, { recursive: true });
  }

  setStatus(status: PrinterStatusKind): void {
    this.status = status;
    this.schedule();
  }

  getMockStatus(): PrinterStatusKind {
    return this.status;
  }

  failNext(kind: 'not_submitted' | 'unknown'): void {
    this.failNextSubmit = kind;
  }

  pendingDocumentKeys(): string[] {
    return this.jobs.map((job) => job.documentKey);
  }

  listPrinters(): Promise<PrinterSummary[]> {
    return Promise.resolve([
      {
        name: MOCK_PRINTER_NAME,
        driverName: 'Grace Booth Mock Driver',
        portName: 'MOCK:',
        isNetwork: false,
        isDefault: true,
      },
    ]);
  }

  getCapabilities(printerName: string): Promise<PrinterCapabilities> {
    return Promise.resolve({
      printerName,
      paperCandidates: [
        { rawKind: 9, name: 'A4', widthHundredths: 827, heightHundredths: 1169 },
        {
          rawKind: 127,
          name: '102 x 152 mm (4 x 6 in)',
          widthHundredths: 400,
          heightHundredths: 600,
        },
      ],
      margins: { left: 13.3, top: 11.9, right: 13.3, bottom: 19.5 },
      dpi: 300,
    });
  }

  getStatus(): Promise<PrinterQueueStatus> {
    return Promise.resolve({ status: this.status, message: statusMessage(this.status) });
  }

  submit(input: SubmitPrintInput): Promise<SubmitPrintResult> {
    const failure = this.failNextSubmit;
    this.failNextSubmit = null;
    if (failure === 'not_submitted') {
      return Promise.reject(new PrintNotSubmittedError('printer_missing', 'Printer not found.'));
    }
    if (this.options.outputDirectory) {
      copyFileSync(input.imagePath, join(this.options.outputDirectory, `${input.documentKey}.png`));
    }
    const spoolerJobId = this.nextJobId++;
    this.jobs.push({
      spoolerJobId,
      documentKey: input.documentKey,
      remainingMs: this.options.printDurationMs ?? 50,
    });
    this.schedule();
    if (failure === 'unknown') return Promise.reject(new Error('Spooler did not answer.'));
    return Promise.resolve({ spoolerJobId });
  }

  findJob(_printerName: string, documentKey: string): Promise<SpoolerJobProbe> {
    const job = this.jobs.find((candidate) => candidate.documentKey === documentKey);
    if (!job) return Promise.resolve({ found: false });
    const problem =
      this.status === 'paper_out' || this.status === 'offline' || this.status === 'error'
        ? this.status
        : null;
    return Promise.resolve({
      found: true,
      spoolerJobId: job.spoolerJobId,
      printed: false,
      problem,
      statusText: problem ?? 'printing',
    });
  }

  cancel(_printerName: string, documentKey: string): Promise<void> {
    const index = this.jobs.findIndex((job) => job.documentKey === documentKey);
    if (index >= 0) this.jobs.splice(index, 1);
    return Promise.resolve();
  }

  hasPrinted(documentKey: string): boolean {
    return this.printedKeys.has(documentKey);
  }

  close(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    return Promise.resolve();
  }

  private schedule(): void {
    if (this.timer || this.status !== 'ready' || this.jobs.length === 0) return;
    const job = this.jobs[0];
    if (!job) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.status !== 'ready') return;
      const done = this.jobs.shift();
      if (done) {
        this.printedKeys.add(done.documentKey);
        this.printed.push(done.documentKey);
      }
      this.schedule();
    }, job.remainingMs);
    this.timer.unref();
  }
}

function statusMessage(status: PrinterStatusKind): string {
  switch (status) {
    case 'ready':
      return 'Printer is ready.';
    case 'printing':
      return 'Printer is printing.';
    case 'offline':
      return 'Printer is offline.';
    case 'paper_out':
      return 'Printer is out of paper.';
    case 'error':
      return 'Printer needs attention.';
    case 'unconfigured':
      return 'No printer is set up.';
    default:
      return 'Printer status is unknown.';
  }
}
