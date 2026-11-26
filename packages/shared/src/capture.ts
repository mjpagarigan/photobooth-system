import { z } from 'zod';

export const MIN_CAPTURE_COUNTDOWN_SECONDS = 1;
export const MAX_CAPTURE_COUNTDOWN_SECONDS = 30;
export const DEFAULT_CAPTURE_COUNTDOWN_SECONDS = 8;

export const CaptureReviewModeSchema = z.enum(['per_shot', 'continuous']);
export type CaptureReviewMode = z.infer<typeof CaptureReviewModeSchema>;

export const DEFAULT_CAPTURE_REVIEW_MODE: CaptureReviewMode = 'per_shot';

export const CaptureCountdownSecondsSchema = z
  .number()
  .int()
  .min(MIN_CAPTURE_COUNTDOWN_SECONDS)
  .max(MAX_CAPTURE_COUNTDOWN_SECONDS);

export const CaptureSettingsSchema = z
  .object({
    countdownSeconds: CaptureCountdownSecondsSchema.default(DEFAULT_CAPTURE_COUNTDOWN_SECONDS),
    reviewMode: CaptureReviewModeSchema.default(DEFAULT_CAPTURE_REVIEW_MODE),
  })
  .strict();
export type CaptureSettings = z.infer<typeof CaptureSettingsSchema>;

export const DEFAULT_CAPTURE_SETTINGS: Readonly<CaptureSettings> = Object.freeze({
  countdownSeconds: DEFAULT_CAPTURE_COUNTDOWN_SECONDS,
  reviewMode: DEFAULT_CAPTURE_REVIEW_MODE,
});

export const SaveCaptureSettingsInputSchema = z
  .object({
    countdownSeconds: CaptureCountdownSecondsSchema,
    reviewMode: CaptureReviewModeSchema,
    expectedRevision: z.number().int().nonnegative(),
  })
  .strict();
export type SaveCaptureSettingsInput = z.infer<typeof SaveCaptureSettingsInputSchema>;
