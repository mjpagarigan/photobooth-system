import { SIGNED_UPLOAD_VALID_FOR_SECONDS } from '../_shared/constants.ts';
import { ApiError } from '../_shared/errors.ts';
import { isR2Configured, photoBucket, publicTokenDerivationKey } from '../_shared/env.ts';
import { assertPost, errorResponse, jsonResponse, readJson, requestId } from '../_shared/http.ts';
import { checkR2ObjectExists, createR2Client, createR2PresignedPutUrl } from '../_shared/r2.ts';
import { CreateOrResumeUploadSchema, parseWithSchema } from '../_shared/schemas.ts';
import { type AdminClient, authenticateBooth, createAdminClient } from '../_shared/supabase.ts';
import { derivePublicToken, hashPublicToken } from '../_shared/token.ts';

const COLLISION_SUFFIX_LIMIT = 32;
type StorageBackend = 'supabase' | 'r2';

type UploadAuthorization = {
  storagePath: string;
  signedUploadToken: string;
  uploadUrl?: string;
  validForSeconds: typeof SIGNED_UPLOAD_VALID_FOR_SECONDS;
};

async function authorizeUpload(
  admin: AdminClient,
  storagePath: string,
  storageBackend: StorageBackend,
  contentType = 'image/jpeg',
): Promise<UploadAuthorization> {
  if (storageBackend === 'r2') {
    const r2 = createR2Client();
    const uploadUrl = await createR2PresignedPutUrl(
      r2,
      storagePath,
      contentType,
      SIGNED_UPLOAD_VALID_FOR_SECONDS,
    );
    return {
      storagePath,
      signedUploadToken: 'r2_presigned',
      uploadUrl,
      validForSeconds: SIGNED_UPLOAD_VALID_FOR_SECONDS,
    };
  }

  const { data, error } = await admin.storage
    .from(photoBucket())
    .createSignedUploadUrl(storagePath, { upsert: false });

  if (error || !data?.token) {
    throw new ApiError(
      503,
      'unavailable',
      'Upload authorization is temporarily unavailable.',
      true,
    );
  }

  return {
    storagePath,
    signedUploadToken: data.token,
    validForSeconds: SIGNED_UPLOAD_VALID_FOR_SECONDS,
  };
}

/**
 * Parses the booth-supplied capture instant for object naming only. Anything absent or malformed
 * falls back to the current UTC time so naming can never reject an upload.
 */
export function parseCaptureTime(raw: unknown): Date {
  if (typeof raw === 'string' && raw.length >= 4 && raw.length <= 64) {
    const parsedMs = Date.parse(raw);
    if (Number.isFinite(parsedMs)) {
      const parsed = new Date(parsedMs);
      const year = parsed.getUTCFullYear();
      if (year >= 1970 && year <= 2100) {
        return parsed;
      }
    }
  }
  return new Date();
}

/** MM-DD-YYYY folder and MM-DD-YYYY-HH-MM-SS.jpg object name derived from the capture instant. */
export function dateBasedStoragePath(capturedAt: Date): string {
  const two = (value: number): string => value.toString().padStart(2, '0');
  const stamp = `${two(capturedAt.getUTCMonth() + 1)}-${two(capturedAt.getUTCDate())}-${
    capturedAt.getUTCFullYear().toString().padStart(4, '0')
  }`;
  const time = `${two(capturedAt.getUTCHours())}-${two(capturedAt.getUTCMinutes())}-${
    two(capturedAt.getUTCSeconds())
  }`;
  return `${stamp}/${stamp}-${time}.jpg`;
}

/** Inserts `-n` before the .jpg extension (08-24-2026-14-32-05-2.jpg). */
export function suffixedObjectPath(basePath: string, suffix: number): string {
  const separator = basePath.lastIndexOf('/');
  const folder = basePath.slice(0, separator);
  const name = basePath.slice(separator + 1);
  const dotted = name.lastIndexOf('.jpg');
  return `${folder}/${name.slice(0, dotted)}-${suffix}.jpg`;
}

function pickAvailableName(name: string, taken: ReadonlySet<string>): string {
  if (!taken.has(name)) return name;
  const dotted = name.lastIndexOf('.jpg');
  const stem = name.slice(0, dotted);
  let candidate = '';
  for (let suffix = 2; suffix < COLLISION_SUFFIX_LIMIT + 2; suffix += 1) {
    candidate = `${stem}-${suffix}.jpg`;
    if (!taken.has(candidate)) return candidate;
  }
  return candidate;
}

async function listExistingObjectNames(
  admin: AdminClient,
  folder: string,
): Promise<Set<string>> {
  const names = new Set<string>();
  const { data, error } = await admin.storage.from(photoBucket()).list(folder, {
    limit: 1_000,
  });
  if (error) {
    throw new ApiError(503, 'unavailable', 'Photo delivery is temporarily unavailable.', true);
  }
  if (Array.isArray(data)) {
    for (const entry of data) {
      if (entry && typeof entry.name === 'string') names.add(entry.name);
    }
  }
  return names;
}

/**
 * Resolves a collision-safe key for the date-based candidate. R2 uses HeadObject checks; the
 * Supabase Storage fallback mirrors the scheme with a listing-based existence probe.
 */
export async function resolveAvailableStoragePath(
  admin: AdminClient,
  basePath: string,
  storageBackend: StorageBackend = isR2Configured() ? 'r2' : 'supabase',
): Promise<string> {
  if (storageBackend === 'r2') {
    const r2 = createR2Client();
    let candidate = basePath;
    for (let suffix = 2; suffix <= COLLISION_SUFFIX_LIMIT; suffix += 1) {
      const probe = await checkR2ObjectExists(r2, candidate);
      if (!probe.exists) return candidate;
      candidate = suffixedObjectPath(basePath, suffix);
    }
    return candidate;
  }

  const separator = basePath.lastIndexOf('/');
  const folder = basePath.slice(0, separator);
  const taken = await listExistingObjectNames(admin, folder);
  return `${folder}/${pickAvailableName(basePath.slice(separator + 1), taken)}`;
}

async function enforceCreateRateLimit(admin: AdminClient, ownerUserId: string): Promise<void> {
  const oneMinuteAgo = new Date(Date.now() - 60_000).toISOString();
  const { count, error } = await admin
    .from('photo_sessions')
    .select('id', { count: 'exact', head: true })
    .eq('owner_user_id', ownerUserId)
    .gte('created_at', oneMinuteAgo);

  if (error) {
    throw new ApiError(503, 'unavailable', 'Photo delivery is temporarily unavailable.', true);
  }
  if ((count ?? 0) >= 12) {
    throw new ApiError(429, 'rate_limited', 'Please wait before starting another upload.', true);
  }
}

async function isExistingClientSession(
  admin: AdminClient,
  ownerUserId: string,
  clientSessionId: string,
): Promise<boolean> {
  const { data, error } = await admin
    .from('photo_sessions')
    .select('id')
    .eq('owner_user_id', ownerUserId)
    .eq('client_session_id', clientSessionId)
    .maybeSingle();
  if (error) {
    throw new ApiError(503, 'unavailable', 'Photo delivery is temporarily unavailable.', true);
  }
  return data !== null;
}

export async function handler(request: Request): Promise<Response> {
  const correlationId = requestId();
  try {
    assertPost(request);
    const admin = createAdminClient();
    const booth = await authenticateBooth(request, admin);
    const input = parseWithSchema(CreateOrResumeUploadSchema, await readJson(request));

    if (input.action === 'resume') {
      const { data: resumedRows, error } = await admin.rpc('resume_or_reopen_photo_session', {
        p_session_id: input.photoSessionId,
        p_owner_user_id: booth.id,
      });
      if (error?.code === 'P0002') {
        throw new ApiError(404, 'not_found', 'The upload session was not found.');
      }
      if (error?.code === 'P0001') {
        throw new ApiError(409, 'conflict', 'This upload session can no longer be resumed.');
      }
      const session = Array.isArray(resumedRows) ? resumedRows[0] : null;
      if (
        error ||
        !session ||
        typeof session.id !== 'string' ||
        typeof session.storage_object_path !== 'string' ||
        typeof session.reopened !== 'boolean'
      ) {
        throw new ApiError(503, 'unavailable', 'Photo delivery is temporarily unavailable.', true);
      }

      if (session.storage_backend !== 'supabase' && session.storage_backend !== 'r2') {
        throw new ApiError(503, 'unavailable', 'Photo delivery is temporarily unavailable.', true);
      }
      const upload = await authorizeUpload(
        admin,
        session.storage_object_path,
        session.storage_backend,
      );
      return jsonResponse({ photoSessionId: session.id, upload }, 200, {}, correlationId);
    }

    if (!(await isExistingClientSession(admin, booth.id, input.clientSessionId))) {
      await enforceCreateRateLimit(admin, booth.id);
    }
    const clientSessionId = input.clientSessionId.toLowerCase();
    const photoSessionId = crypto.randomUUID();
    const publicToken = await derivePublicToken(
      publicTokenDerivationKey(),
      booth.id,
      clientSessionId,
    );
    const publicTokenHash = await hashPublicToken(publicToken);
    const capturedAt = parseCaptureTime(input.capturedAt);
    const baseStoragePath = dateBasedStoragePath(capturedAt);
    const storageBackend: StorageBackend = isR2Configured() ? 'r2' : 'supabase';
    let storagePath = await resolveAvailableStoragePath(
      admin,
      baseStoragePath,
      storageBackend,
    );

    let created: {
      id: string;
      storage_object_path: string;
      storage_backend: StorageBackend;
      created: boolean;
    } | null = null;
    let insertError: { code?: string; message?: string } | null = null;

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const result = await admin.rpc(
        'create_or_get_photo_session',
        {
          p_candidate_id: photoSessionId,
          p_owner_user_id: booth.id,
          p_client_session_id: clientSessionId,
          p_public_token_hash_hex: publicTokenHash,
          p_storage_object_path: storagePath,
          p_storage_backend: storageBackend,
          p_content_type: input.contentType,
          p_byte_size: input.byteSize,
          p_content_sha256_hex: input.sha256,
          p_image_width: input.width,
          p_image_height: input.height,
          p_google_forms_url: input.googleFormsUrl,
        },
      );
      insertError = result.error;
      const createdRows = result.data;
      if (insertError?.code === '23505') {
        // Unique violation on storage_object_path: probe next suffixed candidate and retry
        storagePath = suffixedObjectPath(baseStoragePath, attempt + 2);
        continue;
      }
      created = Array.isArray(createdRows) ? createdRows[0] : null;
      break;
    }

    if (insertError?.code === 'P0001') {
      throw new ApiError(
        409,
        'conflict',
        'This local session already has a different or completed upload.',
      );
    }
    if (
      insertError ||
      !created ||
      typeof created.id !== 'string' ||
      typeof created.storage_object_path !== 'string' ||
      (created.storage_backend !== 'supabase' && created.storage_backend !== 'r2') ||
      typeof created.created !== 'boolean'
    ) {
      throw new ApiError(503, 'unavailable', 'Photo delivery is temporarily unavailable.', true);
    }

    const upload = await authorizeUpload(
      admin,
      created.storage_object_path,
      created.storage_backend,
      input.contentType,
    );
    return jsonResponse(
      { photoSessionId: created.id, publicToken, upload },
      created.created ? 201 : 200,
      {},
      correlationId,
    );
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}

if (import.meta.main) {
  Deno.serve(handler);
}
