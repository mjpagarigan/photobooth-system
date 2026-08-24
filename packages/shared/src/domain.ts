import { z } from 'zod';

export const OpaqueIdSchema = z.uuid();
export const UtcMillisSchema = z.number().int().nonnegative();

export const SessionStateSchema = z.enum([
  'attract',
  'countdown',
  'capturing',
  'review',
  'processing',
  'pending_upload',
  'uploading',
  'ready',
  'final',
  'camera_error',
  'upload_failed',
  'interrupted',
]);
export type SessionState = z.infer<typeof SessionStateSchema>;

export const GuestScreenSchema = z.enum([
  'attract',
  'countdown',
  'capturing',
  'review',
  'processing',
  'final',
  'recovery',
]);
export type GuestScreen = z.infer<typeof GuestScreenSchema>;

export const CropModeSchema = z.enum(['crop-to-fill', 'fit']);
export type CropMode = z.infer<typeof CropModeSchema>;

export const FrameSlotSchema = z
  .object({
    slotIndex: z.number().int().min(1).max(3),
    name: z.string().trim().min(1).max(40),
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().positive().max(1),
    height: z.number().positive().max(1),
    cropMode: CropModeSchema,
  })
  .strict()
  .superRefine((slot, context) => {
    if (slot.x + slot.width > 1 + Number.EPSILON) {
      context.addIssue({
        code: 'custom',
        path: ['width'],
        message: 'Slot must remain within the frame width',
      });
    }
    if (slot.y + slot.height > 1 + Number.EPSILON) {
      context.addIssue({
        code: 'custom',
        path: ['height'],
        message: 'Slot must remain within the frame height',
      });
    }
  });
export type FrameSlot = z.infer<typeof FrameSlotSchema>;

export const FrameLayoutSchema = z
  .array(FrameSlotSchema)
  .length(3)
  .superRefine((slots, context) => {
    const indices = new Set(slots.map((slot) => slot.slotIndex));
    if (indices.size !== 3 || ![1, 2, 3].every((index) => indices.has(index))) {
      context.addIssue({
        code: 'custom',
        message: 'Frame layout must contain slots 1 through 3 exactly once',
      });
    }
  });
export type FrameLayout = z.infer<typeof FrameLayoutSchema>;

export function isAllowedGoogleFormsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      url.username !== '' ||
      url.password !== '' ||
      (url.port !== '' && url.port !== '443')
    ) {
      return false;
    }
    const hostname = url.hostname.toLowerCase();
    if (hostname === 'forms.gle' || hostname === 'forms.google.com') {
      return true;
    }
    return hostname === 'docs.google.com' && url.pathname.startsWith('/forms/');
  } catch {
    return false;
  }
}

export const OptionalGoogleFormsUrlSchema = z
  .union([
    z.literal(''),
    z
      .string()
      .trim()
      .max(2_048)
      .refine(isAllowedGoogleFormsUrl, 'Enter a valid HTTPS Google Forms URL'),
    z.null(),
  ])
  .transform((value) => (value === '' ? null : value));

export const LanSettingsSchema = z
  .object({
    enabled: z.boolean(),
    bindHost: z.ipv4().default('127.0.0.1'),
    port: z.number().int().min(1_024).max(65_535).default(4_310),
    tlsConfigured: z.boolean(),
    certificateFingerprint: z.string().max(128).nullable(),
  })
  .strict();
export type LanSettings = z.infer<typeof LanSettingsSchema>;

export const FrameSummarySchema = z
  .object({
    id: OpaqueIdSchema,
    name: z.string().trim().min(1).max(120),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    byteSize: z.number().int().positive(),
    mediaUrl: z.string().min(1),
    slots: FrameLayoutSchema,
    revision: z.number().int().nonnegative(),
  })
  .strict();
export type FrameSummary = z.infer<typeof FrameSummarySchema>;

export const AdminSettingsSchema = z
  .object({
    googleFormsUrl: OptionalGoogleFormsUrlSchema,
    localRetentionDays: z.literal(60),
    cloudRetentionDays: z.literal(30),
    lan: LanSettingsSchema,
    activeFrame: FrameSummarySchema,
    frames: z.array(FrameSummarySchema).optional(),
    cameraAdapter: z.enum(['mock', 'sony', 'webcam', 'internal_webcam']).default('webcam'),
    cameraDeviceId: z.string().nullable().default(null),
    cameraResolution: z.enum(['720p', '1080p']).default('1080p'),
    supabaseUrl: z.url().max(500).nullable().default(null),
    supabasePublishableKey: z.string().max(1_000).nullable().default(null),
    revision: z.number().int().nonnegative(),
  })
  .strict();
export type AdminSettings = z.infer<typeof AdminSettingsSchema>;

export const GuestErrorCodeSchema = z.enum([
  'camera_unavailable',
  'capture_failed',
  'processing_failed',
  'upload_failed',
  'interrupted',
  'operator_required',
]);
export type GuestErrorCode = z.infer<typeof GuestErrorCodeSchema>;

export const BoothControlsSchema = z
  .object({
    canStart: z.boolean(),
    canRetakeAll: z.boolean(),
    canAcceptPhotos: z.boolean(),
    canRetryUpload: z.boolean(),
    canFinishOffline: z.boolean().default(false),
    canFinish: z.boolean(),
  })
  .strict();

export const BoothMediaSchema = z
  .object({
    captureUrls: z.array(z.string().min(1)).max(3),
    collageUrl: z.string().min(1).nullable(),
    frame: FrameSummarySchema.nullable().optional(),
    frames: z.array(FrameSummarySchema).optional(),
    qrImageUrl: z.string().min(1).nullable(),
  })
  .strict();

export const BoothSnapshotSchema = z
  .object({
    screen: GuestScreenSchema,
    state: SessionStateSchema.nullable(),
    sessionId: OpaqueIdSchema.nullable(),
    shotNumber: z.number().int().min(1).max(3).nullable(),
    captureCount: z.number().int().min(0).max(3),
    countdownEndsAt: UtcMillisSchema.nullable(),
    cameraPreviewEnabled: z.boolean(),
    media: BoothMediaSchema,
    controls: BoothControlsSchema,
    errorCode: GuestErrorCodeSchema.nullable(),
    message: z.string().max(300).nullable(),
  })
  .strict();
export type BoothSnapshot = z.infer<typeof BoothSnapshotSchema>;

export const UploadJobStateSchema = z.enum([
  'queued',
  'creating_upload',
  'uploading',
  'confirming',
  'retry_wait',
  'failed',
  'succeeded',
  'cancelled',
]);
export type UploadJobState = z.infer<typeof UploadJobStateSchema>;

export const GalleryUploadStatusSchema = z.enum(['pending', 'uploaded', 'failed', 'local-receipt']);
export type GalleryUploadStatus = z.infer<typeof GalleryUploadStatusSchema>;

export const GalleryItemMetadataSchema = z
  .object({
    capturedAt: UtcMillisSchema,
    photoCount: z.number().int().min(0).max(3),
    frameName: z.string().max(120).nullable(),
    uploadStatus: GalleryUploadStatusSchema,
    cloudExpiresAt: UtcMillisSchema.nullable(),
  })
  .strict();
export type GalleryItemMetadata = z.infer<typeof GalleryItemMetadataSchema>;

export const GalleryItemSchema = z
  .object({
    sessionId: OpaqueIdSchema,
    previewDataUrl: z.string().min(1).max(2_000_000),
    qrDataUrl: z.string().min(1).max(100_000).nullable(),
    metadata: GalleryItemMetadataSchema,
  })
  .strict();
export type GalleryItem = z.infer<typeof GalleryItemSchema>;

export const UploadJobSummarySchema = z
  .object({
    id: OpaqueIdSchema,
    sessionId: OpaqueIdSchema,
    state: UploadJobStateSchema,
    attemptCount: z.number().int().nonnegative(),
    automaticRetryIndex: z.number().int().min(0).max(3),
    nextAttemptAt: UtcMillisSchema.nullable(),
    lastErrorCode: z.string().max(80).nullable(),
    lastErrorMessage: z.string().max(300).nullable(),
    createdAt: UtcMillisSchema,
    updatedAt: UtcMillisSchema,
  })
  .strict();
export type UploadJobSummary = z.infer<typeof UploadJobSummarySchema>;

export const HealthStateSchema = z.enum(['healthy', 'degraded', 'unavailable', 'unconfigured']);
export const ServiceHealthSchema = z
  .object({
    state: HealthStateSchema,
    code: z.string().max(80).nullable(),
    message: z.string().max(300),
    checkedAt: UtcMillisSchema,
  })
  .strict();
export const AdminHealthSchema = z
  .object({
    camera: ServiceHealthSchema,
    cloud: ServiceHealthSchema,
    database: ServiceHealthSchema,
    encryption: ServiceHealthSchema,
  })
  .strict();
export type AdminHealth = z.infer<typeof AdminHealthSchema>;

export const AdminAuthStatusSchema = z
  .object({
    configured: z.boolean(),
    authenticated: z.boolean(),
    expiresAt: UtcMillisSchema.nullable(),
  })
  .strict();
export type AdminAuthStatus = z.infer<typeof AdminAuthStatusSchema>;

export const RpcErrorCodeSchema = z.enum([
  'invalid_request',
  'unauthorized',
  'forbidden',
  'conflict',
  'not_found',
  'rate_limited',
  'unavailable',
  'internal_error',
]);
export const RpcErrorSchema = z
  .object({
    code: RpcErrorCodeSchema,
    message: z.string().min(1).max(300),
    retryable: z.boolean(),
  })
  .strict();
export type RpcError = z.infer<typeof RpcErrorSchema>;

export function rpcResultSchema<T extends z.ZodType>(dataSchema: T) {
  return z.discriminatedUnion('ok', [
    z.object({ ok: z.literal(true), data: dataSchema }).strict(),
    z.object({ ok: z.literal(false), error: RpcErrorSchema }).strict(),
  ]);
}

export type RpcResult<T> = { ok: true; data: T } | { ok: false; error: RpcError };

export const EmptyResponseSchema = z.object({}).strict();
export type EmptyResponse = z.infer<typeof EmptyResponseSchema>;
