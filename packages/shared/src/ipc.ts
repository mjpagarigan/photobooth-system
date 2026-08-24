import { z } from 'zod';
import {
  CameraAdapterKindSchema,
  CameraConfigSchema,
  CameraResolutionSchema,
  type CameraAdapterKind,
  type CameraConfig,
  type CameraResolution,
} from './camera.js';
import {
  AdminAuthStatusSchema,
  AdminHealthSchema,
  AdminSettingsSchema,
  BoothSnapshotSchema,
  EmptyResponseSchema,
  FrameLayoutSchema,
  FrameSummarySchema,
  GalleryItemSchema,
  OpaqueIdSchema,
  OptionalGoogleFormsUrlSchema,
  UploadJobSummarySchema,
  rpcResultSchema,
  type AdminAuthStatus,
  type AdminHealth,
  type AdminSettings,
  type BoothSnapshot,
  type EmptyResponse,
  type FrameLayout,
  type FrameSummary,
  type GalleryItem,
  type RpcResult,
  type UploadJobSummary,
} from './domain.js';

export const EmptyRequestSchema = z.object({}).strict();
export const PasscodeSchema = z.string().min(8).max(64);

const SuccessMessageSchema = z.object({ message: z.string().max(300) }).strict();

/** A 20 MiB JPEG ceiling expressed as base64 characters, well below the 50 MiB capture limit. */
export const MAX_CAMERA_FRAME_BASE64_LENGTH = 28_000_000;

export const IpcContracts = {
  'booth:get-snapshot': {
    request: EmptyRequestSchema,
    response: rpcResultSchema(BoothSnapshotSchema),
  },
  'booth:start': {
    request: EmptyRequestSchema,
    response: rpcResultSchema(BoothSnapshotSchema),
  },
  'booth:retake-all': {
    request: EmptyRequestSchema,
    response: rpcResultSchema(BoothSnapshotSchema),
  },
  'booth:accept-photos': {
    request: z
      .object({
        frameId: OpaqueIdSchema,
      })
      .strict(),
    response: rpcResultSchema(BoothSnapshotSchema),
  },
  'booth:retry-upload': {
    request: EmptyRequestSchema,
    response: rpcResultSchema(BoothSnapshotSchema),
  },
  'booth:finish-offline': {
    request: EmptyRequestSchema,
    response: rpcResultSchema(BoothSnapshotSchema),
  },
  'booth:done': {
    request: EmptyRequestSchema,
    response: rpcResultSchema(BoothSnapshotSchema),
  },
  'booth:cancel-session': {
    request: EmptyRequestSchema,
    response: rpcResultSchema(BoothSnapshotSchema),
  },
  'booth:get-cameras': {
    request: EmptyRequestSchema,
    response: rpcResultSchema(CameraConfigSchema),
  },
  'booth:set-camera': {
    request: z
      .object({
        adapter: CameraAdapterKindSchema,
        deviceId: z.string().nullable().optional(),
        resolution: CameraResolutionSchema.default('1080p'),
      })
      .strict(),
    response: rpcResultSchema(CameraConfigSchema),
  },
  'booth:submit-camera-frame': {
    request: z
      .object({
        captureId: OpaqueIdSchema,
        jpegBase64: z
          .string()
          .min(4)
          .max(MAX_CAMERA_FRAME_BASE64_LENGTH)
          .regex(/^[A-Za-z0-9+/]+={0,2}$/, 'Camera frame must be standard base64'),
      })
      .strict(),
    response: rpcResultSchema(EmptyResponseSchema),
  },
  'gallery:get-recent': {
    request: z
      .object({
        limit: z.number().int().min(1).max(50).default(20),
      })
      .strict(),
    response: rpcResultSchema(z.array(GalleryItemSchema)),
  },
  'admin:get-auth-status': {
    request: EmptyRequestSchema,
    response: rpcResultSchema(AdminAuthStatusSchema),
  },
  'admin:login': {
    request: z.object({ passcode: PasscodeSchema }).strict(),
    response: rpcResultSchema(AdminAuthStatusSchema),
  },
  'admin:logout': {
    request: EmptyRequestSchema,
    response: rpcResultSchema(EmptyResponseSchema),
  },
  'admin:bootstrap-passcode': {
    request: z.object({ passcode: PasscodeSchema }).strict(),
    response: rpcResultSchema(AdminAuthStatusSchema),
  },
  'admin:change-passcode': {
    request: z.object({ currentPasscode: PasscodeSchema, newPasscode: PasscodeSchema }).strict(),
    response: rpcResultSchema(EmptyResponseSchema),
  },
  'admin:get-settings': {
    request: EmptyRequestSchema,
    response: rpcResultSchema(AdminSettingsSchema),
  },
  'admin:save-settings': {
    request: z
      .object({
        googleFormsUrl: OptionalGoogleFormsUrlSchema,
        lanEnabled: z.boolean(),
        lanBindHost: z.ipv4(),
        lanPort: z.number().int().min(1_024).max(65_535),
        expectedRevision: z.number().int().nonnegative(),
      })
      .strict(),
    response: rpcResultSchema(AdminSettingsSchema),
  },
  'admin:list-frames': {
    request: EmptyRequestSchema,
    response: rpcResultSchema(z.array(FrameSummarySchema)),
  },
  'admin:add-frame': {
    request: EmptyRequestSchema,
    response: rpcResultSchema(FrameSummarySchema.nullable()),
  },
  'admin:update-frame-layout': {
    request: z
      .object({
        frameId: OpaqueIdSchema,
        name: z.string().trim().min(1).max(120),
        slots: FrameLayoutSchema,
        expectedRevision: z.number().int().nonnegative(),
      })
      .strict(),
    response: rpcResultSchema(FrameSummarySchema),
  },
  'admin:delete-frame': {
    request: z.object({ frameId: OpaqueIdSchema }).strict(),
    response: rpcResultSchema(z.array(FrameSummarySchema)),
  },
  'admin:move-frame': {
    request: z
      .object({
        frameId: OpaqueIdSchema,
        direction: z.union([z.literal('up'), z.literal('down')]),
      })
      .strict(),
    response: rpcResultSchema(z.array(FrameSummarySchema)),
  },
  'admin:choose-lan-certificate': {
    request: z.object({ passphrase: z.string().min(1).max(1_024) }).strict(),
    response: rpcResultSchema(SuccessMessageSchema.nullable()),
  },
  'admin:list-upload-jobs': {
    request: z
      .object({
        cursor: z.string().max(200).nullable().default(null),
        limit: z.number().int().min(1).max(100).default(50),
      })
      .strict(),
    response: rpcResultSchema(
      z
        .object({
          items: z.array(UploadJobSummarySchema),
          nextCursor: z.string().max(200).nullable(),
        })
        .strict(),
    ),
  },
  'admin:retry-upload': {
    request: z.object({ uploadJobId: OpaqueIdSchema }).strict(),
    response: rpcResultSchema(UploadJobSummarySchema),
  },
  'admin:get-health': {
    request: EmptyRequestSchema,
    response: rpcResultSchema(AdminHealthSchema),
  },
  'admin:restart-session': {
    request: z.object({ sessionId: OpaqueIdSchema }).strict(),
    response: rpcResultSchema(BoothSnapshotSchema),
  },
  'admin:connect-cloud': {
    request: z
      .object({
        email: z.email().max(320),
        password: z.string().min(1).max(1_024),
        supabaseUrl: z.url().max(500).optional().nullable(),
        supabasePublishableKey: z.string().trim().min(20).max(1_000).optional().nullable(),
      })
      .strict(),
    response: rpcResultSchema(SuccessMessageSchema),
  },
} as const;

export const BOOTH_SNAPSHOT_EVENT = 'booth:snapshot-changed' as const;
export const BoothSnapshotEventSchema = BoothSnapshotSchema;

export const CAMERA_FRAME_REQUEST_EVENT = 'booth:camera-frame-requested' as const;
export const CameraFrameRequestEventSchema = z
  .object({ captureId: OpaqueIdSchema, deadlineAt: z.number().int().positive() })
  .strict();
export type CameraFrameRequestEvent = z.infer<typeof CameraFrameRequestEventSchema>;

export type IpcChannel = keyof typeof IpcContracts;
export type IpcRequest<C extends IpcChannel> = z.input<(typeof IpcContracts)[C]['request']>;
export type IpcResponse<C extends IpcChannel> = z.output<(typeof IpcContracts)[C]['response']>;

export type GraceBoothBridge = {
  booth: {
    getSnapshot(): Promise<RpcResult<BoothSnapshot>>;
    start(): Promise<RpcResult<BoothSnapshot>>;
    retakeAll(): Promise<RpcResult<BoothSnapshot>>;
    acceptPhotos(input: { frameId: string }): Promise<RpcResult<BoothSnapshot>>;
    retryUpload(): Promise<RpcResult<BoothSnapshot>>;
    finishOffline(): Promise<RpcResult<BoothSnapshot>>;
    done(): Promise<RpcResult<BoothSnapshot>>;
    cancelSession(): Promise<RpcResult<BoothSnapshot>>;
    getCameras(): Promise<RpcResult<CameraConfig>>;
    setCamera(input: {
      adapter: CameraAdapterKind;
      deviceId?: string | null;
      resolution: CameraResolution;
    }): Promise<RpcResult<CameraConfig>>;
    submitCameraFrame(captureId: string, jpegBase64: string): Promise<RpcResult<EmptyResponse>>;
    subscribe(listener: (snapshot: BoothSnapshot) => void): () => void;
    onCameraFrameRequest(listener: (request: CameraFrameRequestEvent) => void): () => void;
  };
  gallery: {
    getRecent(limit?: number): Promise<RpcResult<GalleryItem[]>>;
  };
  admin: {
    getAuthStatus(): Promise<RpcResult<AdminAuthStatus>>;
    login(passcode: string): Promise<RpcResult<AdminAuthStatus>>;
    logout(): Promise<RpcResult<EmptyResponse>>;
    bootstrapPasscode(passcode: string): Promise<RpcResult<AdminAuthStatus>>;
    changePasscode(currentPasscode: string, newPasscode: string): Promise<RpcResult<EmptyResponse>>;
    getSettings(): Promise<RpcResult<AdminSettings>>;
    saveSettings(input: {
      googleFormsUrl: string | null;
      lanEnabled: boolean;
      lanBindHost: string;
      lanPort: number;
      expectedRevision: number;
    }): Promise<RpcResult<AdminSettings>>;
    listFrames(): Promise<RpcResult<FrameSummary[]>>;
    addFrame(): Promise<RpcResult<FrameSummary | null>>;
    updateFrameLayout(input: {
      frameId: string;
      name: string;
      slots: FrameLayout;
      expectedRevision: number;
    }): Promise<RpcResult<FrameSummary>>;
    deleteFrame(frameId: string): Promise<RpcResult<FrameSummary[]>>;
    moveFrame(input: {
      frameId: string;
      direction: 'up' | 'down';
    }): Promise<RpcResult<FrameSummary[]>>;
    chooseLanCertificate(passphrase: string): Promise<RpcResult<{ message: string } | null>>;
    listUploadJobs(input?: {
      cursor?: string | null;
      limit?: number;
    }): Promise<RpcResult<{ items: UploadJobSummary[]; nextCursor: string | null }>>;
    retryUpload(uploadJobId: string): Promise<RpcResult<UploadJobSummary>>;
    getHealth(): Promise<RpcResult<AdminHealth>>;
    restartSession(sessionId: string): Promise<RpcResult<BoothSnapshot>>;
    connectCloud(
      email: string,
      password: string,
      supabaseUrl?: string | null,
      supabasePublishableKey?: string | null,
    ): Promise<RpcResult<{ message: string }>>;
  };
};
