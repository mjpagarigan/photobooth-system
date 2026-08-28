import type { S3Client } from 'npm:@aws-sdk/client-s3@^3.750.0';
import { ApiError } from './errors.ts';
import type { AdminClient } from './supabase.ts';

export type StoredPhoto = {
  storage_object_path: string;
  storage_backend: 'supabase' | 'r2';
  content_type: 'image/jpeg';
  byte_size: number;
};

export type StorageVerificationDependencies = {
  isR2Configured: () => boolean;
  createR2Client: () => S3Client;
  checkR2ObjectExists: (
    client: S3Client,
    key: string,
  ) => Promise<{ exists: boolean; byteSize: number | null }>;
  photoBucket: () => string;
};

export type StorageVerificationResult = 'available' | 'missing' | 'mismatch';

function isStorageNotFound(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as {
    status?: number;
    statusCode?: number | string;
    message?: string;
  };
  return (
    candidate.status === 404 ||
    candidate.statusCode === 404 ||
    candidate.statusCode === '404' ||
    candidate.message?.toLowerCase().includes('not found') === true
  );
}

export async function verifyStoredPhoto(
  admin: AdminClient,
  photo: StoredPhoto,
  dependencies: StorageVerificationDependencies,
): Promise<StorageVerificationResult> {
  if (photo.storage_backend === 'r2') {
    if (!dependencies.isR2Configured()) {
      throw new ApiError(
        503,
        'unavailable',
        'Storage verification is temporarily unavailable.',
        true,
      );
    }
    let object: { exists: boolean; byteSize: number | null };
    try {
      object = await dependencies.checkR2ObjectExists(
        dependencies.createR2Client(),
        photo.storage_object_path,
      );
    } catch {
      throw new ApiError(
        503,
        'unavailable',
        'Storage verification is temporarily unavailable.',
        true,
      );
    }
    if (!object.exists) return 'missing';
    return object.byteSize === Number(photo.byte_size) ? 'available' : 'mismatch';
  }

  const bucket = admin.storage.from(dependencies.photoBucket()) as unknown as {
    info(path: string): Promise<{ data: unknown; error: unknown }>;
  };
  let result: { data: unknown; error: unknown };
  try {
    result = await bucket.info(photo.storage_object_path);
  } catch {
    throw new ApiError(
      503,
      'unavailable',
      'Storage verification is temporarily unavailable.',
      true,
    );
  }
  if (result.error) {
    if (isStorageNotFound(result.error)) return 'missing';
    throw new ApiError(
      503,
      'unavailable',
      'Storage verification is temporarily unavailable.',
      true,
    );
  }
  if (!result.data || typeof result.data !== 'object') {
    throw new ApiError(
      503,
      'unavailable',
      'Storage verification is temporarily unavailable.',
      true,
    );
  }

  const metadata = result.data as {
    size?: unknown;
    mimetype?: unknown;
    contentType?: unknown;
    metadata?: { mimetype?: unknown; contentType?: unknown };
  };
  const contentType = metadata.mimetype ??
    metadata.contentType ??
    metadata.metadata?.mimetype ??
    metadata.metadata?.contentType;
  return Number(metadata.size) === Number(photo.byte_size) && contentType === photo.content_type
    ? 'available'
    : 'mismatch';
}

export function throwForStorageVerification(result: StorageVerificationResult): void {
  if (result === 'missing') {
    throw new ApiError(404, 'not_found', 'This photo is unavailable or has expired.');
  }
  if (result === 'mismatch') {
    throw new ApiError(
      503,
      'unavailable',
      'Photo delivery is temporarily unavailable.',
      true,
    );
  }
}
