import { z } from 'zod';
import { OpaqueIdSchema, OptionalGoogleFormsUrlSchema } from './domain.js';

export const Sha256HexSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const PublicTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

export const CreateUploadRequestSchema = z
  .object({
    action: z.literal('create'),
    clientSessionId: OpaqueIdSchema,
    contentType: z.literal('image/jpeg'),
    byteSize: z.number().int().positive(),
    sha256: Sha256HexSchema,
    width: z.number().int().min(1).max(6_000),
    height: z.number().int().min(1).max(6_000),
    googleFormsUrl: OptionalGoogleFormsUrlSchema,
    /** ISO-8601 capture instant used to derive the human-readable cloud object name. */
    capturedAt: z.iso.datetime({ offset: true }).optional(),
  })
  .strict();
export type CreateUploadRequest = z.infer<typeof CreateUploadRequestSchema>;

export const ResumeUploadRequestSchema = z
  .object({
    action: z.literal('resume'),
    photoSessionId: OpaqueIdSchema,
  })
  .strict();
export type ResumeUploadRequest = z.infer<typeof ResumeUploadRequestSchema>;

export const UploadAuthorizationSchema = z
  .object({
    storagePath: z.string().min(1).max(500),
    signedUploadToken: z.string().min(1).max(8_192),
    uploadUrl: z.url().optional(),
    validForSeconds: z.literal(7_200),
  })
  .strict();

export const CreateUploadResponseSchema = z
  .object({
    photoSessionId: OpaqueIdSchema,
    publicToken: PublicTokenSchema,
    upload: UploadAuthorizationSchema,
  })
  .strict();
export type CreateUploadResponse = z.infer<typeof CreateUploadResponseSchema>;

export const ResumeUploadResponseSchema = z
  .object({
    photoSessionId: OpaqueIdSchema,
    upload: UploadAuthorizationSchema,
  })
  .strict();
export type ResumeUploadResponse = z.infer<typeof ResumeUploadResponseSchema>;

export const ConfirmUploadRequestSchema = z
  .object({
    photoSessionId: OpaqueIdSchema,
    publicToken: PublicTokenSchema,
  })
  .strict();
export type ConfirmUploadRequest = z.infer<typeof ConfirmUploadRequestSchema>;

export const ConfirmUploadResponseSchema = z
  .object({
    status: z.literal('ready'),
    readyAt: z.iso.datetime({ offset: true }),
    expiresAt: z.iso.datetime({ offset: true }),
    publicPageOrigin: z
      .url()
      .refine((value) => {
        if (value.startsWith('https://')) return true;
        if (value.startsWith('http://')) {
          try {
            const url = new URL(value);
            return (
              url.hostname === '127.0.0.1' ||
              url.hostname === 'localhost' ||
              url.hostname.endsWith('.local') ||
              /^192\.168\.\d+\.\d+$/.test(url.hostname) ||
              /^10\.\d+\.\d+\.\d+$/.test(url.hostname) ||
              /^172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(url.hostname)
            );
          } catch {
            return false;
          }
        }
        return false;
      })
      .transform((value) => new URL(value).origin),
    publicPath: z.literal('/photo'),
  })
  .strict();
export type ConfirmUploadResponse = z.infer<typeof ConfirmUploadResponseSchema>;

export const PhotoAvailabilitySchema = z.enum([
  'available',
  'unavailable',
  'verification-failed',
]);
export type PhotoAvailability = z.infer<typeof PhotoAvailabilitySchema>;

export const PhotoRepairMetadataSchema = z
  .object({
    byteSize: z.number().int().positive(),
    sha256: Sha256HexSchema,
    width: z.number().int().min(1).max(6_000),
    height: z.number().int().min(1).max(6_000),
  })
  .strict();
export type PhotoRepairMetadata = z.infer<typeof PhotoRepairMetadataSchema>;

export const AuthorizePhotoRepairRequestSchema = z
  .object({
    action: z.literal('authorize'),
    photoSessionId: OpaqueIdSchema,
    publicToken: PublicTokenSchema,
    metadata: PhotoRepairMetadataSchema,
  })
  .strict();
export type AuthorizePhotoRepairRequest = z.infer<typeof AuthorizePhotoRepairRequestSchema>;

export const AuthorizePhotoRepairResponseSchema = z
  .object({
    action: z.literal('authorize'),
    repairBatchId: OpaqueIdSchema,
    upload: z
      .object({
        storagePath: z.string().min(1).max(500),
        uploadUrl: z.url(),
        requiredHeaders: z
          .object({
            'content-type': z.literal('image/jpeg'),
            'if-none-match': z.literal('*'),
          })
          .strict(),
        validForSeconds: z.literal(300),
      })
      .strict(),
  })
  .strict();
export type AuthorizePhotoRepairResponse = z.infer<typeof AuthorizePhotoRepairResponseSchema>;

export const ConfirmPhotoRepairRequestSchema = z
  .object({
    action: z.literal('confirm'),
    photoSessionId: OpaqueIdSchema,
    publicToken: PublicTokenSchema,
    repairBatchId: OpaqueIdSchema,
    metadata: PhotoRepairMetadataSchema,
  })
  .strict();
export type ConfirmPhotoRepairRequest = z.infer<typeof ConfirmPhotoRepairRequestSchema>;

export const BoothAuthSessionSchema = z
  .object({
    accessToken: z.string().min(1),
    refreshToken: z.string().default(''),
    expiresAt: z.number().int().positive(),
    userId: OpaqueIdSchema,
  })
  .strict();
export type BoothAuthSession = z.infer<typeof BoothAuthSessionSchema>;
