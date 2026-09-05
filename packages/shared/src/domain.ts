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
    slotIndex: z.number().int().min(1).max(10),
    zIndex: z.number().int().min(0).max(9).default(0),
    name: z.string().trim().min(1).max(40),
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().min(0.001).max(1),
    height: z.number().min(0.001).max(1),
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
  .min(1)
  .max(10)
  .superRefine((slots, context) => {
    const indices = new Set(slots.map((slot) => slot.slotIndex));
    if (
      indices.size !== slots.length ||
      !Array.from({ length: slots.length }, (_, index) => index + 1).every((index) =>
        indices.has(index),
      )
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Frame layout must contain sequential slots starting at 1 exactly once',
      });
    }
  });
export type FrameLayout = z.infer<typeof FrameLayoutSchema>;

export function isAllowedGoogleFormsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      url.username === '' &&
      url.password === '' &&
      (url.port === '' || url.port === '443') &&
      url.hostname.length > 0 &&
      value.length <= 2_048
    );
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
      .refine(isAllowedGoogleFormsUrl, 'Enter a valid HTTPS URL'),
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
    active: z.boolean().optional(),
  })
  .strict();
export type FrameSummary = z.infer<typeof FrameSummarySchema>;

export const FrameImportCandidateSchema = z.object({
  candidateId: OpaqueIdSchema,
  suggestedName: z.string().trim().min(1).max(120),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  byteSize: z.number().int().positive(),
}).strict();
export type FrameImportCandidate = z.infer<typeof FrameImportCandidateSchema>;

export const DualDisplayModeSchema = z.enum(['auto', 'enabled', 'disabled']);
export type DualDisplayMode = z.infer<typeof DualDisplayModeSchema>;

export const DualDisplaySettingsSchema = z
  .object({
    mode: DualDisplayModeSchema.default('auto'),
    swapDisplays: z.boolean().default(false),
    qrDismissSeconds: z.number().int().min(10).max(300).default(45),
  })
  .strict();
export type DualDisplaySettings = z.infer<typeof DualDisplaySettingsSchema>;

export const DisplayInfoSchema = z
  .object({
    id: z.number(),
    label: z.string(),
    bounds: z
      .object({
        x: z.number(),
        y: z.number(),
        width: z.number(),
        height: z.number(),
      })
      .strict(),
    isPrimary: z.boolean(),
  })
  .strict();
export type DisplayInfo = z.infer<typeof DisplayInfoSchema>;

export const QrStationStateSchema = z
  .object({
    status: z.enum(['idle', 'active', 'error']),
    sessionId: OpaqueIdSchema.nullable(),
    collageUrl: z.string().nullable(),
    qrImageUrl: z.string().nullable(),
    expiresAt: UtcMillisSchema.nullable(),
    durationSeconds: z.number().int().positive(),
    message: z.string().nullable(),
    canRetryUpload: z.boolean().default(false),
    queuedCount: z.number().int().nonnegative().default(0),
  })
  .strict();
export type QrStationState = z.infer<typeof QrStationStateSchema>;

export const GooglePhotosConfigSchema = z
  .object({
    connectedEmail: z.string().nullable().default(null),
    albumId: z.string().nullable().default(null),
    albumTitle: z.string().nullable().default(null),
    albumShareUrl: z.string().nullable().default(null),
    enabled: z.boolean().default(false),
  })
  .strict();
export type GooglePhotosConfig = z.infer<typeof GooglePhotosConfigSchema>;

export const GoogleSyncStatsSchema = z
  .object({
    syncedCount: z.number().int().nonnegative().default(0),
    pendingCount: z.number().int().nonnegative().default(0),
    failedCount: z.number().int().nonnegative().default(0),
    lastSyncedAt: UtcMillisSchema.nullable().default(null),
  })
  .strict();
export type GoogleSyncStats = z.infer<typeof GoogleSyncStatsSchema>;

export const GooglePhotosStatusSchema = z
  .object({
    config: GooglePhotosConfigSchema,
    stats: GoogleSyncStatsSchema,
    hasRefreshToken: z.boolean().default(false),
    hasCredentials: z.boolean().default(true),
    authUrl: z.string().nullable().optional(),
  })
  .strict();
export type GooglePhotosStatus = z.infer<typeof GooglePhotosStatusSchema>;

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
    dualDisplay: DualDisplaySettingsSchema.optional().default({
      mode: 'auto',
      swapDisplays: false,
      qrDismissSeconds: 45,
    }),
    googlePhotos: GooglePhotosConfigSchema.optional().default({
      connectedEmail: null,
      albumId: null,
      albumTitle: null,
      albumShareUrl: null,
      enabled: false,
    }),
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
    captureUrls: z.array(z.string().min(1)).max(10),
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
    shotNumber: z.number().int().min(1).max(10).nullable(),
    captureCount: z.number().int().min(0).max(10),
    requiredShotCount: z.number().int().min(1).max(10).optional(),
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

export const GalleryUploadStatusSchema = z.enum([
  'pending',
  'uploaded',
  'failed',
  'local-receipt',
  'unavailable',
  'verification-failed',
]);
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

export const GalleryCloudRepairResultSchema = z
  .object({
    status: z.enum(['repaired', 'original-booth-required']),
    message: z.string().min(1).max(300),
  })
  .strict();
export type GalleryCloudRepairResult = z.infer<typeof GalleryCloudRepairResultSchema>;

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
