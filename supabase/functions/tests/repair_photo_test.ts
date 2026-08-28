import { assertEquals } from 'jsr:@std/assert@1.0.14';
import type { AdminClient } from '../_shared/supabase.ts';
import type { StorageVerificationResult } from '../_shared/storage-verification.ts';
import { sha256Hex } from '../_shared/token.ts';
import {
  handler,
  type RepairPhotoDependencies,
  type RepairPhotoSession,
} from '../repair-photo/index.ts';

const TOKEN = 'A'.repeat(43);
const TOKEN_HASH = 'a'.repeat(64);
const SESSION_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OWNER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const BATCH_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const NOW = Date.parse('2026-08-27T00:00:00.000Z');
const JPEG = new Uint8Array([
  0xff,
  0xd8,
  0xff,
  0xc0,
  0x00,
  0x0b,
  0x08,
  0x0e,
  0x10,
  0x04,
  0xb0,
  0x01,
  0x01,
  0x11,
  0x00,
  0xff,
  0xd9,
]);
const JPEG_HASH = await sha256Hex(JPEG);

const SESSION: RepairPhotoSession = {
  id: SESSION_ID,
  owner_user_id: OWNER_ID,
  public_token_hash: TOKEN_HASH,
  storage_object_path: '08-27-2026/08-27-2026-08-00-00.jpg',
  storage_backend: 'supabase',
  status: 'ready',
  content_type: 'image/jpeg',
  byte_size: JPEG.byteLength,
  content_sha256: JPEG_HASH,
  image_width: 1200,
  image_height: 3600,
  ready_at: '2026-08-27T00:00:00.000Z',
  expires_at: '2026-09-26T00:00:00.000Z',
};

function request(
  action: 'authorize' | 'confirm',
  metadata: Record<string, unknown> = {},
): Request {
  return new Request('https://api.example.test/functions/v1/repair-photo', {
    method: 'POST',
    headers: { authorization: 'Bearer test-access-token', 'content-type': 'application/json' },
    body: JSON.stringify({
      action,
      photoSessionId: SESSION_ID,
      publicToken: TOKEN,
      ...(action === 'confirm' ? { repairBatchId: BATCH_ID } : {}),
      metadata: {
        byteSize: JPEG.byteLength,
        sha256: JPEG_HASH,
        width: 1200,
        height: 3600,
        ...metadata,
      },
    }),
  });
}

function dependencies(options: {
  session?: RepairPhotoSession | null;
  storage?: Partial<Record<'supabase' | 'r2', StorageVerificationResult>>;
  r2Bytes?: Uint8Array | null;
} = {}): {
  deps: RepairPhotoDependencies;
  repairCalls: unknown[];
  signedOptions: unknown[];
} {
  const repairCalls: unknown[] = [];
  const signedOptions: unknown[] = [];
  const admin = {
    rpc(_name: string, args: unknown) {
      repairCalls.push(args);
      return Promise.resolve({ data: 'updated', error: null });
    },
  } as unknown as AdminClient;
  return {
    repairCalls,
    signedOptions,
    deps: {
      createAdminClient: () => admin,
      authenticateBooth: () => Promise.resolve({ id: OWNER_ID } as never),
      loadSession: () => Promise.resolve(options.session === undefined ? SESSION : options.session),
      verifyStoredPhoto: (_admin, photo) =>
        Promise.resolve(options.storage?.[photo.storage_backend] ?? 'missing'),
      createR2Client: () => ({}) as ReturnType<RepairPhotoDependencies['createR2Client']>,
      createR2PresignedPutUrl: (_client, _path, _type, _expiry, signed) => {
        signedOptions.push(signed);
        return Promise.resolve('https://r2.example.test/conditional-upload');
      },
      getR2ObjectBytes: () => Promise.resolve(options.r2Bytes ?? JPEG),
      hashPublicToken: () => Promise.resolve(TOKEN_HASH),
      sha256Hex,
      photoBucket: () => 'photos',
      publicPageOrigin: () => 'https://photos.example.test',
      repairBatchId: () => BATCH_ID,
      now: () => NOW,
    },
  };
}

Deno.test('authorize permits only a missing-both photo and signs a non-overwriting PUT', async () => {
  const setup = dependencies();
  const response = await handler(request('authorize'), setup.deps);
  assertEquals(response.status, 200);
  assertEquals(await response.json(), {
    action: 'authorize',
    repairBatchId: BATCH_ID,
    upload: {
      storagePath: SESSION.storage_object_path,
      uploadUrl: 'https://r2.example.test/conditional-upload',
      requiredHeaders: { 'content-type': 'image/jpeg', 'if-none-match': '*' },
      validForSeconds: 300,
    },
  });
  assertEquals(setup.signedOptions, [{ ifNoneMatch: '*' }]);
});

Deno.test('authorize rejects a photo still present in either storage backend', async () => {
  for (const storage of [{ supabase: 'available' }, { r2: 'available' }] as const) {
    const setup = dependencies({ storage });
    const response = await handler(request('authorize'), setup.deps);
    assertEquals(response.status, 409);
  }
});

Deno.test('confirm validates the recovered JPEG and invokes the guarded repair RPC', async () => {
  const setup = dependencies();
  const response = await handler(request('confirm'), setup.deps);
  assertEquals(response.status, 200);
  assertEquals(await response.json(), {
    status: 'ready',
    readyAt: SESSION.ready_at,
    expiresAt: SESSION.expires_at,
    publicPageOrigin: 'https://photos.example.test',
    publicPath: '/photo',
  });
  assertEquals(setup.repairCalls, [{
    p_batch_id: BATCH_ID,
    p_session_id: SESSION_ID,
    p_expected_storage_object_path: SESSION.storage_object_path,
    p_expected_byte_size: JPEG.byteLength,
    p_expected_content_sha256_hex: JPEG_HASH,
    p_expected_expires_at: SESSION.expires_at,
    p_expected_status: 'ready',
    p_expected_storage_backend: 'supabase',
    p_source: 'kiosk-reupload',
  }]);
});

Deno.test('repair rejects wrong metadata, token, expiry, and recovered bytes', async () => {
  const wrongBooth = dependencies({ session: null });
  assertEquals((await handler(request('authorize'), wrongBooth.deps)).status, 404);

  const wrongMetadata = dependencies();
  assertEquals(
    (await handler(request('authorize', { byteSize: JPEG.byteLength + 1 }), wrongMetadata.deps))
      .status,
    409,
  );

  const wrongToken = dependencies();
  wrongToken.deps.hashPublicToken = () => Promise.resolve('b'.repeat(64));
  assertEquals((await handler(request('authorize'), wrongToken.deps)).status, 403);

  const expired = dependencies({
    session: { ...SESSION, expires_at: new Date(NOW - 1).toISOString() },
  });
  assertEquals((await handler(request('authorize'), expired.deps)).status, 409);

  const wrongBytes = dependencies({ r2Bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]) });
  assertEquals((await handler(request('confirm'), wrongBytes.deps)).status, 422);
});
