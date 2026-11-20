import type {
  PrinterAdapterKind,
  PrinterCapabilities,
  PrinterStatusKind,
  PrinterSummary,
} from '@grace-booth/shared';

export type PrinterQueueStatus = {
  status: PrinterStatusKind;
  message: string;
};

/** What the spooler currently knows about one of our documents. */
export type SpoolerJobProbe =
  | { found: false }
  | {
      found: true;
      spoolerJobId: number;
      /** The spooler kept the document after printing ("Keep printed documents"). */
      printed: boolean;
      problem: 'paper_out' | 'offline' | 'error' | null;
      statusText: string;
    };

export type SubmitPrintInput = {
  printerName: string;
  paperRawKind: number | null;
  paperName: string | null;
  /** Unique per copy; set as the spooler DocumentName so recovery can find it. */
  documentKey: string;
  /** Full-page PNG at page size (6 × 4 in landscape). */
  imagePath: string;
};

export type SubmitPrintResult = { spoolerJobId: number | null };

/**
 * Thrown when the adapter can prove the document never reached the spooler, so the copy can be
 * queued again without any risk of a second print.
 */
export class PrintNotSubmittedError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'PrintNotSubmittedError';
  }
}

export type PrinterAdapter = {
  readonly kind: PrinterAdapterKind;
  listPrinters(): Promise<PrinterSummary[]>;
  getCapabilities(printerName: string): Promise<PrinterCapabilities>;
  getStatus(printerName: string): Promise<PrinterQueueStatus>;
  submit(input: SubmitPrintInput): Promise<SubmitPrintResult>;
  findJob(printerName: string, documentKey: string): Promise<SpoolerJobProbe>;
  cancel(printerName: string, documentKey: string): Promise<void>;
  close(): Promise<void>;
};
