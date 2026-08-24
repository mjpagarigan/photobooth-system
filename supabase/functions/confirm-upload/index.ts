import { byteaToHex, constantTimeEqual } from '../_shared/encoding.ts';
import { ApiError } from '../_shared/errors.ts';
import { isR2Configured, photoBucket, publicPageOrigin } from '../_shared/env.ts';
import { assertPost, errorResponse, jsonResponse, readJson, requestId } from '../_shared/http.ts';
import { assertExpectedJpeg } from '../_shared/jpeg.ts';
import { createR2Client, getR2ObjectBytes } from '../_shared/r2.ts';
import { ConfirmUploadSchema, parseWithSchema } from '../_shared/schemas.ts';
import { type AdminClient, authenticateBooth, createAdminClient } from '../_shared/supabase.ts';
import { hashPublicToken, sha256Hex } from '../_shared/token.ts';

type PhotoSessionRow = {
  id: string;
  public_token_hash: string;
  storage_object_path: string;
  storage_backend: 'supabase' | 'r2';
  status: 'pending' | 'ready' | 'expired' | 'deleting' | 'deleted';
  content_type: string;
  byte_size: number;
  content_sha256: string;
  image_width: number;
  image_height: number;
  delivery_generation: number;
  ready_at: string | null;
  expires_at: string | null;
};

export type ConfirmStorageDependencies = {
  isR2Configured: typeof isR2Configured;
  createR2Client: typeof createR2Client;
  getR2ObjectBytes: typeof getR2ObjectBytes;
  photoBucket: typeof photoBucket;
};

const DEFAULT_STORAGE_DEPENDENCIES: ConfirmStorageDependencies = {
  isR2Configured,
  createR2Client,
  getR2ObjectBytes,
  photoBucket,
};

export async function readUploadedBytes(
  admin: AdminClient,
  session: Pick<PhotoSessionRow, 'storage_backend' | 'storage_object_path' | 'content_type'>,
  dependencies: ConfirmStorageDependencies = DEFAULT_STORAGE_DEPENDENCIES,
): Promise<Uint8Array> {
  if (session.storage_backend === 'r2') {
    if (!dependencies.isR2Configured()) {
      throw new ApiError(503, 'unavailable', 'Photo delivery is temporarily unavailable.', true);
    }
    const r2 = dependencies.createR2Client();
    const r2Bytes = await dependencies.getR2ObjectBytes(r2, session.storage_object_path);
    if (!r2Bytes) {
      throw new ApiError(409, 'conflict', 'The uploaded image is not available yet.', true);
    }
    return r2Bytes;
  }
  if (session.storage_backend !== 'supabase') {
    throw new ApiError(503, 'unavailable', 'Photo delivery is temporarily unavailable.', true);
  }
  const { data: uploaded, error: downloadError } = await admin.storage
    .from(dependencies.photoBucket())
    .download(session.storage_object_path);
  if (downloadError || !uploaded) {
    throw new ApiError(409, 'conflict', 'The uploaded image is not available yet.', true);
  }
  if (uploaded.type && uploaded.type.toLowerCase() !== session.content_type) {
    throw new ApiError(422, 'conflict', 'The uploaded image has an unexpected content type.');
  }
  return new Uint8Array(await uploaded.arrayBuffer());
}

type FinalizedRow = {
  status: 'ready';
  ready_at: string;
  expires_at: string;
};

function readyResponse(row: FinalizedRow): Record<string, unknown> {
  return {
    status: 'ready',
    readyAt: row.ready_at,
    expiresAt: row.expires_at,
    publicPageOrigin: publicPageOrigin(),
    publicPath: '/photo',
  };
}

function asFinalizedRow(value: unknown): FinalizedRow | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<FinalizedRow>;
  if (
    candidate.status !== 'ready' ||
    typeof candidate.ready_at !== 'string' ||
    typeof candidate.expires_at !== 'string'
  ) {
    return null;
  }
  return candidate as FinalizedRow;
}

export async function handler(request: Request): Promise<Response> {
  const correlationId = requestId();
  try {
    assertPost(request);
    const admin = createAdminClient();
    const booth = await authenticateBooth(request, admin);
    const input = parseWithSchema(ConfirmUploadSchema, await readJson(request));

    const { data, error } = await admin
      .from('photo_sessions')
      .select(
        'id, public_token_hash, storage_object_path, storage_backend, status, content_type, byte_size, content_sha256, image_width, image_height, delivery_generation, ready_at, expires_at',
      )
      .eq('id', input.photoSessionId)
      .eq('owner_user_id', booth.id)
      .maybeSingle();

    if (error) {
      throw new ApiError(503, 'unavailable', 'Photo delivery is temporarily unavailable.', true);
    }
    if (!data) {
      throw new ApiError(404, 'not_found', 'The upload session was not found.');
    }

    const session = data as PhotoSessionRow;
    const expectedTokenHash = byteaToHex(session.public_token_hash);
    const receivedTokenHash = await hashPublicToken(input.publicToken);
    if (!expectedTokenHash || !constantTimeEqual(expectedTokenHash, receivedTokenHash)) {
      throw new ApiError(403, 'forbidden', 'The upload session could not be confirmed.');
    }

    if (session.status === 'ready') {
      if (!session.ready_at || !session.expires_at) {
        throw new ApiError(500, 'internal_error', 'The photo session is inconsistent.', true);
      }
      return jsonResponse(
        readyResponse({
          status: 'ready',
          ready_at: session.ready_at,
          expires_at: session.expires_at,
        }),
        200,
        {},
        correlationId,
      );
    }
    if (session.status !== 'pending') {
      throw new ApiError(409, 'conflict', 'This upload session can no longer be confirmed.');
    }

    const bytes = await readUploadedBytes(admin, session);
    assertExpectedJpeg(bytes, {
      byteSize: Number(session.byte_size),
      width: session.image_width,
      height: session.image_height,
    });
    const expectedContentHash = byteaToHex(session.content_sha256);
    const actualContentHash = await sha256Hex(bytes);
    if (!expectedContentHash || !constantTimeEqual(expectedContentHash, actualContentHash)) {
      throw new ApiError(422, 'conflict', 'The uploaded image does not match the expected file.');
    }

    const { data: finalized, error: finalizeError } = await admin.rpc('finalize_photo_session', {
      p_session_id: session.id,
      p_owner_user_id: booth.id,
      p_public_token_hash_hex: receivedTokenHash,
      p_delivery_generation: session.delivery_generation,
    });
    if (finalizeError?.code === 'P0002') {
      throw new ApiError(404, 'not_found', 'The upload session was not found.');
    }
    if (finalizeError?.code === 'P0001') {
      if (finalizeError.message === 'public_token_mismatch') {
        throw new ApiError(403, 'forbidden', 'The upload session could not be confirmed.');
      }
      throw new ApiError(409, 'conflict', 'This upload session can no longer be confirmed.');
    }
    const row = Array.isArray(finalized) ? asFinalizedRow(finalized[0]) : null;
    if (finalizeError || !row) {
      throw new ApiError(503, 'unavailable', 'The upload could not be confirmed.', true);
    }

    return jsonResponse(readyResponse(row), 200, {}, correlationId);
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}

if (import.meta.main) {
  Deno.serve(handler);
}
