import { z } from 'zod';

import { OpaqueIdSchema, UtcMillisSchema } from './domain.js';

/** Landscape 4R (6 × 4 in) expressed as width / height. */
export const PRINT_4R_ASPECT = 3 / 2;
/** A Frame is printable when its aspect is within this relative tolerance of 3:2. */
export const PRINT_4R_ASPECT_TOLERANCE = 0.005;
/** 4R paper in hundredths of an inch, as Windows drivers report it (portrait). */
export const PAPER_4R_HUNDREDTHS = Object.freeze({ shortEdge: 400, longEdge: 600 });
/** Below this size a 4R Frame prints visibly soft at 300 DPI. */
export const PRINT_4R_MIN_PIXELS = Object.freeze({ width: 1_800, height: 1_200 });
/** Technical guard against a mistyped copy count; there is no product limit. */
export const MAX_COPIES_PER_REQUEST = 999;

export function isPrintableFrameSize(width: number, height: number): boolean {
  if (!(width > 0 && height > 0)) return false;
  return Math.abs(width / height / PRINT_4R_ASPECT - 1) <= PRINT_4R_ASPECT_TOLERANCE;
}

export const PrinterAdapterKindSchema = z.enum(['windows', 'mock']);
export type PrinterAdapterKind = z.infer<typeof PrinterAdapterKindSchema>;

export const PrinterStatusKindSchema = z.enum([
  'unconfigured',
  'ready',
  'printing',
  'offline',
  'paper_out',
  'error',
  'unknown',
]);
export type PrinterStatusKind = z.infer<typeof PrinterStatusKindSchema>;

export const PrinterHealthSchema = z
  .object({
    status: PrinterStatusKindSchema,
    printerName: z.string().max(260).nullable(),
    message: z.string().max(300),
    queuedCount: z.number().int().nonnegative(),
    attentionCount: z.number().int().nonnegative(),
    checkedAt: UtcMillisSchema,
  })
  .strict();
export type PrinterHealth = z.infer<typeof PrinterHealthSchema>;

export const PrintJobStateSchema = z.enum([
  'waiting_for_photo',
  'queued',
  'submitting',
  'spooled',
  'printed',
  'needs_attention',
  'failed',
  'cancelled',
]);
export type PrintJobState = z.infer<typeof PrintJobStateSchema>;

export const PrintJobKindSchema = z.enum(['session', 'reprint', 'calibration', 'color_test']);
export type PrintJobKind = z.infer<typeof PrintJobKindSchema>;

export const PrintJobSummarySchema = z
  .object({
    id: OpaqueIdSchema,
    requestId: OpaqueIdSchema,
    sessionId: OpaqueIdSchema.nullable(),
    kind: PrintJobKindSchema,
    copyIndex: z.number().int().positive(),
    copyCount: z.number().int().positive(),
    state: PrintJobStateSchema,
    printerName: z.string().max(260).nullable(),
    lastErrorCode: z.string().max(80).nullable(),
    lastErrorMessage: z.string().max(300).nullable(),
    createdAt: UtcMillisSchema,
    updatedAt: UtcMillisSchema,
    printedAt: UtcMillisSchema.nullable(),
  })
  .strict();
export type PrintJobSummary = z.infer<typeof PrintJobSummarySchema>;

export const PrinterSummarySchema = z
  .object({
    name: z.string().min(1).max(260),
    driverName: z.string().max(260),
    portName: z.string().max(260),
    isNetwork: z.boolean(),
    isDefault: z.boolean(),
  })
  .strict();
export type PrinterSummary = z.infer<typeof PrinterSummarySchema>;

export const PaperCandidateSchema = z
  .object({
    rawKind: z.number().int(),
    name: z.string().max(260),
    widthHundredths: z.number().int().positive(),
    heightHundredths: z.number().int().positive(),
  })
  .strict();
export type PaperCandidate = z.infer<typeof PaperCandidateSchema>;

/** Hard margins in hundredths of an inch, in portrait paper coordinates. */
export const PaperMarginsSchema = z
  .object({
    left: z.number().nonnegative(),
    top: z.number().nonnegative(),
    right: z.number().nonnegative(),
    bottom: z.number().nonnegative(),
  })
  .strict();
export type PaperMargins = z.infer<typeof PaperMarginsSchema>;

export const PrinterCapabilitiesSchema = z
  .object({
    printerName: z.string().min(1).max(260),
    paperCandidates: z.array(PaperCandidateSchema),
    margins: PaperMarginsSchema.nullable(),
    dpi: z.number().int().positive().nullable(),
  })
  .strict();
export type PrinterCapabilities = z.infer<typeof PrinterCapabilitiesSchema>;

export const PrinterSettingsSchema = z
  .object({
    adapter: PrinterAdapterKindSchema,
    printerName: z.string().max(260).nullable(),
    paperRawKind: z.number().int().nullable(),
    paperName: z.string().max(260).nullable(),
    timeoutSeconds: z.number().int().min(30).max(1_800),
    iccProfileName: z.string().max(260).nullable(),
    revision: z.number().int().nonnegative(),
  })
  .strict();
export type PrinterSettings = z.infer<typeof PrinterSettingsSchema>;

export const PrintCopiesSchema = z.number().int().min(1).max(MAX_COPIES_PER_REQUEST);
export const SessionPrintRequestSchema = z.object({ copies: PrintCopiesSchema }).strict();
export type SessionPrintRequest = z.infer<typeof SessionPrintRequestSchema>;
