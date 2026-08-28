import type { S3Client } from 'npm:@aws-sdk/client-s3@^3.750.0';
import { byteaToHex, constantTimeEqual } from '../_shared/encoding.ts';
import { ApiError } from '../_shared/errors.ts';
import { isR2Configured, photoBucket, publicPageOrigin } from '../_shared/env.ts';
import { assertPost, errorResponse, jsonResponse, readJson, requestId } from '../_shared/http.ts';
import { assertExpectedJpeg } from '../_shared/jpeg.ts';
import {
  checkR2ObjectExists,
  createR2Client,
  createR2PresignedPutUrl,
  getR2ObjectBytes,
} from '../_shared/r2.ts';
import { parseWithSchema, RepairPhotoSchema } from '../_shared/schemas.ts';
import {
  type StorageVerificationResult,
  verifyStoredPhoto,
} from '../_shared/storage-verification.ts';
import { type AdminClient, authenticateBooth, createAdminClient } from '../_shared/supabase.ts';
import { hashPublicToken, sha256Hex } from '../_shared/token.ts';

const REPAIR_UPLOAD_VALID_FOR_SECONDS = 300;

export type RepairPhotoSession = {
  id: string;
  owner_user_id: string;
  public_token_hash: string;
  storage_object_path: string;
  storage_backend: 'supabase' | 'r2';
  status: 'pending' | 'ready' | 'expired' | 'deleting' | 'deleted';
  content_type: 'image/jpeg';
  byte_size: number;
  content_sha256: string;
  image_width: number;
  image_height: number;
  ready_at: string | null;
  expires_at: string | null;
};

type LoadSession = (
  admin: AdminClient,
  sessionId: string,
  ownerUserId: string,
) => Promise<RepairPhotoSession | null>;

async function loadSession(
  admin: AdminClient,
  sessionId: string,
  ownerUserId: string,
): Promise<RepairPhotoSession | null> {
  const { data, error } = await admin
    .from('photo_sessions')
    .select(
      'id, owner_user_id, public_token_hash, storage_object_path, storage_backend, status, content_type, byte_size, content_sha256, image_width, image_height, ready_at, expires_at',
    )
    .eq('id', sessionId)
    .eq('owner_user_id', ownerUserId)
    .maybeSingle();
  if (error) {
    throw new ApiError(503, 'unavailable', 'Photo recovery is temporarily unavailable.', true);
  }
  return data ? (data as RepairPhotoSession) : null;
}

export type RepairPhotoDependencies = {
  createAdminClient: typeof createAdminClient;
  authenticateBooth: typeof authenticateBooth;
  loadSession: LoadSession;
  verifyStoredPhoto: (
    admin: AdminClient,
    photo: Pick<
      RepairPhotoSession,
      'storage_backend' | 'storage_object_path' | 'content_type' | 'byte_size'
    >,
  ) => Promise<StorageVerificationResult>;
  createR2Client: typeof createR2Client;
  createR2PresignedPutUrl: typeof createR2PresignedPutUrl;
  getR2ObjectBytes: (client: S3Client, key: string) => Promise<Uint8Array | null>;
  hashPublicToken: typeof hashPublicToken;
  sha256Hex: typeof sha256Hex;
  photoBucket: typeof photoBucket;
  publicPageOrigin: typeof publicPageOrigin;
  repairBatchId: () => string;
  now: () => number;
};

const DEFAULT_DEPENDENCIES: RepairPhotoDependencies = {
  createAdminClient,
  authenticateBooth,
  loadSession,
  verifyStoredPhoto: (admin, photo) =>
    verifyStoredPhoto(admin, photo, {
      isR2Configured,
      createR2Client,
      checkR2ObjectExists,
      photoBucket,
    }),
  createR2Client,
  createR2PresignedPutUrl,
  getR2ObjectBytes,
  hashPublicToken,
  sha256Hex,
  photoBucket,
  publicPageOrigin,
  repairBatchId: crypto.randomUUID,
  now: Date.now,
};

function asStoragePhoto(
  session: RepairPhotoSession,
  storageBackend: 'supabase' | 'r2',
): Pick<
  RepairPhotoSession,
  'storage_backend' | 'storage_object_path' | 'content_type' | 'byte_size'
> {
  return {
    storage_backend: storageBackend,
    storage_object_path: session.storage_object_path,
    content_type: session.content_type,
    byte_size: Number(session.byte_size),
  };
}

async function assertRepairableSession(
  session: RepairPhotoSession | null,
  input: {
    publicToken: string;
    metadata: { byteSize: number; sha256: string; width: number; height: number };
  },
  dependencies: RepairPhotoDependencies,
  allowAlreadyRepaired: boolean,
): Promise<RepairPhotoSession> {
  if (!session) {
    throw new ApiError(404, 'not_found', 'The photo recovery record was not found.');
  }
  const expectedTokenHash = byteaToHex(session.public_token_hash);
  const receivedTokenHash = await dependencies.hashPublicToken(input.publicToken);
  if (!expectedTokenHash || !constantTimeEqual(expectedTokenHash, receivedTokenHash)) {
    throw new ApiError(403, 'forbidden', 'The photo could not be recovered by this booth.');
  }
  const expectedContentHash = byteaToHex(session.content_sha256);
  const metadataMatches = Number(session.byte_size) === input.metadata.byteSize &&
    expectedContentHash !== null &&
    constantTimeEqual(expectedContentHash, input.metadata.sha256) &&
    session.image_width === input.metadata.width &&
    session.image_height === input.metadata.height;
  const expiresAt = session.expires_at ? Date.parse(session.expires_at) : Number.NaN;
  if (
    !metadataMatches ||
    session.status !== 'ready' ||
    !session.ready_at ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= dependencies.now() ||
    (session.storage_backend !== 'supabase' && !allowAlreadyRepaired)
  ) {
    throw new ApiError(409, 'conflict', 'This photo is not eligible for cloud recovery.');
  }
  return session;
}

async function assertStorageAbsent(
  admin: AdminClient,
  session: RepairPhotoSession,
  backend: 'supabase' | 'r2',
  dependencies: RepairPhotoDependencies,
): Promise<void> {
  const availability = await dependencies.verifyStoredPhoto(
    admin,
    asStoragePhoto(session, backend),
  );
  if (availability !== 'missing') {
    throw new ApiError(409, 'conflict', 'A cloud object already exists for this photo.');
  }
}

function readyResponse(session: RepairPhotoSession, origin: string): Record<string, unknown> {
  return {
    status: 'ready',
    readyAt: session.ready_at,
    expiresAt: session.expires_at,
    publicPageOrigin: origin,
    publicPath: '/photo',
  };
}

export async function handler(
  request: Request,
  dependencies: RepairPhotoDependencies = DEFAULT_DEPENDENCIES,
): Promise<Response> {
  const correlationId = requestId();
  try {
    assertPost(request);
    const admin = dependencies.createAdminClient();
    const booth = await dependencies.authenticateBooth(request, admin);
    const input = parseWithSchema(RepairPhotoSchema, await readJson(request));
    const loaded = await dependencies.loadSession(admin, input.photoSessionId, booth.id);
    const session = await assertRepairableSession(
      loaded,
      input,
      dependencies,
      input.action === 'confirm',
    );

    await assertStorageAbsent(admin, session, 'supabase', dependencies);

    if (input.action === 'authorize') {
      await assertStorageAbsent(admin, session, 'r2', dependencies);
      const uploadUrl = await dependencies.createR2PresignedPutUrl(
        dependencies.createR2Client(),
        session.storage_object_path,
        session.content_type,
        REPAIR_UPLOAD_VALID_FOR_SECONDS,
        { ifNoneMatch: '*' },
      );
      return jsonResponse(
        {
          action: 'authorize',
          repairBatchId: dependencies.repairBatchId(),
          upload: {
            storagePath: session.storage_object_path,
            uploadUrl,
            requiredHeaders: {
              'content-type': 'image/jpeg',
              'if-none-match': '*',
            },
            validForSeconds: REPAIR_UPLOAD_VALID_FOR_SECONDS,
          },
        },
        200,
        {},
        correlationId,
      );
    }

    const bytes = await dependencies.getR2ObjectBytes(
      dependencies.createR2Client(),
      session.storage_object_path,
    );
    if (!bytes) {
      throw new ApiError(409, 'conflict', 'The recovered upload is not available yet.', true);
    }
    assertExpectedJpeg(bytes, {
      byteSize: Number(session.byte_size),
      width: session.image_width,
      height: session.image_height,
    });
    const actualContentHash = await dependencies.sha256Hex(bytes);
    const expectedContentHash = byteaToHex(session.content_sha256);
    if (!expectedContentHash || !constantTimeEqual(expectedContentHash, actualContentHash)) {
      throw new ApiError(422, 'conflict', 'The recovered image does not match the original.');
    }

    const { data: repairOutcome, error: repairError } = await admin.rpc(
      'repair_photo_storage_backend',
      {
        p_batch_id: input.repairBatchId,
        p_session_id: session.id,
        p_expected_storage_object_path: session.storage_object_path,
        p_expected_byte_size: Number(session.byte_size),
        p_expected_content_sha256_hex: expectedContentHash,
        p_expected_expires_at: session.expires_at,
        p_expected_status: 'ready',
        p_expected_storage_backend: 'supabase',
        p_source: 'kiosk-reupload',
      },
    );
    const outcome = Array.isArray(repairOutcome) ? repairOutcome[0] : repairOutcome;
    if (repairError || (outcome !== 'updated' && outcome !== 'already_applied')) {
      if (repairError?.code === 'P0001' || outcome === 'stale') {
        throw new ApiError(409, 'conflict', 'The photo changed during cloud recovery.');
      }
      throw new ApiError(503, 'unavailable', 'Photo recovery is temporarily unavailable.', true);
    }

    return jsonResponse(
      readyResponse(session, dependencies.publicPageOrigin()),
      200,
      {},
      correlationId,
    );
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}

if (import.meta.main) {
  Deno.serve((request) => handler(request));
}
