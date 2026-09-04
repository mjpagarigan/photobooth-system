import { z } from 'npm:zod@4.4.3';
import {
  MAX_EDGE_PIXELS,
  MIN_LONG_EDGE_PIXELS,
  PUBLIC_TOKEN_PATTERN,
  SHA256_HEX_PATTERN,
} from './constants.ts';
import { ApiError } from './errors.ts';

const GoogleFormsUrlSchema = z
  .union([z.literal(''), z.url().max(2048), z.null()])
  .transform((value) => (value === '' ? null : value))
  .superRefine((value, context) => {
    if (value === null) return;
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      url.username !== '' ||
      url.password !== '' ||
      (url.port !== '' && url.port !== '443') ||
      url.hostname.length === 0
    ) {
      context.addIssue({ code: 'custom', message: 'Invalid URL' });
    }
  });

const CreateUploadSchema = z
  .object({
    action: z.literal('create'),
    clientSessionId: z.uuid(),
    contentType: z.literal('image/jpeg'),
    byteSize: z.number().int().positive(),
    sha256: z.string().regex(SHA256_HEX_PATTERN),
    width: z.number().int().min(1).max(MAX_EDGE_PIXELS),
    height: z.number().int().min(1).max(MAX_EDGE_PIXELS),
    googleFormsUrl: GoogleFormsUrlSchema,
    // Deliberately lenient: naming must never reject an upload. The handler parses this
    // defensively and falls back to the current UTC time when absent or malformed.
    capturedAt: z.string().max(64).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (Math.max(value.width, value.height) < MIN_LONG_EDGE_PIXELS) {
      context.addIssue({
        code: 'custom',
        path: ['width'],
        message: `The finished image long edge must be at least ${
          String(MIN_LONG_EDGE_PIXELS)
        } pixels`,
      });
    }
  });

const ResumeUploadSchema = z
  .object({ action: z.literal('resume'), photoSessionId: z.uuid() })
  .strict();

export const CreateOrResumeUploadSchema = z.discriminatedUnion('action', [
  CreateUploadSchema,
  ResumeUploadSchema,
]);

export const ConfirmUploadSchema = z
  .object({
    photoSessionId: z.uuid(),
    publicToken: z.string().regex(PUBLIC_TOKEN_PATTERN),
  })
  .strict();

const RepairPhotoMetadataSchema = z
  .object({
    byteSize: z.number().int().positive(),
    sha256: z.string().regex(SHA256_HEX_PATTERN),
    width: z.number().int().min(1).max(MAX_EDGE_PIXELS),
    height: z.number().int().min(1).max(MAX_EDGE_PIXELS),
  })
  .strict();

const AuthorizePhotoRepairSchema = z
  .object({
    action: z.literal('authorize'),
    photoSessionId: z.uuid(),
    publicToken: z.string().regex(PUBLIC_TOKEN_PATTERN),
    metadata: RepairPhotoMetadataSchema,
  })
  .strict();

const ConfirmPhotoRepairSchema = z
  .object({
    action: z.literal('confirm'),
    photoSessionId: z.uuid(),
    publicToken: z.string().regex(PUBLIC_TOKEN_PATTERN),
    repairBatchId: z.uuid(),
    metadata: RepairPhotoMetadataSchema,
  })
  .strict();

export const RepairPhotoSchema = z.discriminatedUnion('action', [
  AuthorizePhotoRepairSchema,
  ConfirmPhotoRepairSchema,
]);

export const PublicPhotoTokenSchema = z
  .object({ token: z.string().regex(PUBLIC_TOKEN_PATTERN) })
  .strict();

export function parseWithSchema<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ApiError(400, 'invalid_request', 'The request body is invalid.');
  }
  return result.data;
}
