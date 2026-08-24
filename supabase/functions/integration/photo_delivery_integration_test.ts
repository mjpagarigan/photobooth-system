import { assert, assertEquals, assertMatch, assertNotEquals } from 'jsr:@std/assert@1.0.14';
import { createClient } from 'npm:@supabase/supabase-js@2.112.3';

type JsonRecord = Record<string, unknown>;

type TestConfiguration = {
  supabaseUrl: string;
  publishableKey: string;
  secretKey: string;
  jwtSecret: string;
  publicOrigin: string;
  cleanupSecret: string;
};

type BoothIdentity = {
  id: string;
  email: string;
  password: string;
  accessToken: string;
};

type CreatedUpload = {
  photoSessionId: string;
  publicToken: string;
  upload: {
    storagePath: string;
    signedUploadToken: string;
    validForSeconds: number;
  };
};

const RUN_INTEGRATION = Deno.env.get('GRACE_BOOTH_RUN_SUPABASE_INTEGRATION') === '1';

function requiredEnvironment(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`${name} is required for the local Supabase integration suite`);
  return value;
}

function firstEnvironment(names: string[]): string {
  for (const name of names) {
    const value = Deno.env.get(name)?.trim();
    if (value) return value;
  }
  throw new Error(`${names.join(' or ')} is required for the local Supabase integration suite`);
}

function configuration(): TestConfiguration {
  const supabaseUrl = (Deno.env.get('SUPABASE_URL') ?? 'http://127.0.0.1:54321').replace(
    /\/+$/u,
    '',
  );
  const parsed = new URL(supabaseUrl);
  if (parsed.hostname !== '127.0.0.1' && parsed.hostname !== 'localhost') {
    throw new Error('The integration suite refuses to mutate a non-loopback Supabase project');
  }
  return {
    supabaseUrl: parsed.origin,
    publishableKey: firstEnvironment(['SUPABASE_PUBLISHABLE_KEY', 'ANON_KEY']),
    secretKey: firstEnvironment([
      'SUPABASE_SECRET_KEY',
      'SUPABASE_SERVICE_ROLE_KEY',
      'SERVICE_ROLE_KEY',
    ]),
    jwtSecret: requiredEnvironment('JWT_SECRET'),
    publicOrigin: Deno.env.get('PUBLIC_PAGE_ORIGIN')?.trim() || 'http://127.0.0.1:4173',
    cleanupSecret: requiredEnvironment('CLEANUP_SECRET'),
  };
}

function randomEmail(label: string): string {
  return `grace-booth-${label}-${crypto.randomUUID()}@example.invalid`;
}

function randomPassword(): string {
  return `Gb!${crypto.randomUUID()}`;
}

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '');
}

async function localAccessToken(
  config: TestConfiguration,
  userId: string,
  email: string,
): Promise<string> {
  const encoder = new TextEncoder();
  const issuedAt = Math.floor(Date.now() / 1_000);
  const header = base64url(encoder.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const payload = base64url(
    encoder.encode(
      JSON.stringify({
        aud: 'authenticated',
        email,
        exp: issuedAt + 3_600,
        iat: issuedAt,
        iss: `${config.supabaseUrl}/auth/v1`,
        role: 'authenticated',
        sub: userId,
      }),
    ),
  );
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(config.jwtSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(`${header}.${payload}`));
  return `${header}.${payload}.${base64url(new Uint8Array(signature))}`;
}

async function readJson(response: Response): Promise<JsonRecord> {
  const value = await response.json() as unknown;
  assert(value && typeof value === 'object' && !Array.isArray(value));
  return value as JsonRecord;
}

async function assertStatus(
  response: Response,
  expected: number | readonly number[],
): Promise<void> {
  const accepted = Array.isArray(expected) ? expected : [expected];
  assert(
    accepted.includes(response.status),
    `Expected HTTP ${accepted.join(' or ')}, received ${response.status}: ${await response.clone()
      .text()}`,
  );
}

async function serviceRequest(
  config: TestConfiguration,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('apikey', config.secretKey);
  headers.set('Authorization', `Bearer ${config.secretKey}`);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  return await fetch(`${config.supabaseUrl}${path}`, { ...init, headers });
}

async function createBooth(config: TestConfiguration, label: string): Promise<BoothIdentity> {
  const email = randomEmail(label);
  const password = randomPassword();
  const createResponse = await serviceRequest(config, '/auth/v1/admin/users', {
    method: 'POST',
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  await assertStatus(createResponse, [200, 201]);
  const created = await readJson(createResponse);
  assert(typeof created.id === 'string');

  const enrollment = await serviceRequest(config, '/rest/v1/booth_devices', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ user_id: created.id, device_name: `Integration ${label}` }),
  });
  await assertStatus(enrollment, 201);

  const accessToken = await localAccessToken(config, created.id, email);
  return { id: created.id, email, password, accessToken };
}

async function setBoothEnabled(
  config: TestConfiguration,
  boothId: string,
  enabled: boolean,
): Promise<void> {
  const response = await serviceRequest(
    config,
    `/rest/v1/booth_devices?user_id=eq.${encodeURIComponent(boothId)}`,
    {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ enabled }),
    },
  );
  await assertStatus(response, 204);
}

async function functionRequest(
  config: TestConfiguration,
  functionPath: string,
  accessToken: string,
  body: unknown,
): Promise<Response> {
  return await fetch(`${config.supabaseUrl}/functions/v1/${functionPath}`, {
    method: 'POST',
    headers: {
      apikey: config.publishableKey,
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

async function publicPhotoRequest(
  config: TestConfiguration,
  route: 'resolve' | 'image' | 'download',
  token: string,
): Promise<Response> {
  return await fetch(`${config.supabaseUrl}/functions/v1/photo/${route}`, {
    method: 'POST',
    headers: { Origin: config.publicOrigin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
}

function minimalJpeg(width: number, height: number): Uint8Array {
  return new Uint8Array([
    0xff,
    0xd8,
    0xff,
    0xc0,
    0x00,
    0x0b,
    0x08,
    (height >> 8) & 0xff,
    height & 0xff,
    (width >> 8) & 0xff,
    width & 0xff,
    0x01,
    0x01,
    0x11,
    0x00,
    0xff,
    0xd9,
  ]);
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const owned = Uint8Array.from(bytes);
  const digest = await crypto.subtle.digest('SHA-256', owned.buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(
    '',
  );
}

function createBody(clientSessionId: string, bytes: Uint8Array, sha256?: string): JsonRecord {
  return {
    action: 'create',
    clientSessionId,
    contentType: 'image/jpeg',
    byteSize: bytes.byteLength,
    sha256: sha256 ?? '',
    width: 1200,
    height: 3600,
    googleFormsUrl: null,
  };
}

function asCreatedUpload(value: JsonRecord): CreatedUpload {
  assert(typeof value.photoSessionId === 'string');
  assert(typeof value.publicToken === 'string');
  assert(value.upload && typeof value.upload === 'object' && !Array.isArray(value.upload));
  const upload = value.upload as JsonRecord;
  assert(typeof upload.storagePath === 'string');
  assert(typeof upload.signedUploadToken === 'string');
  assert(typeof upload.validForSeconds === 'number');
  return {
    photoSessionId: value.photoSessionId,
    publicToken: value.publicToken,
    upload: {
      storagePath: upload.storagePath,
      signedUploadToken: upload.signedUploadToken,
      validForSeconds: upload.validForSeconds,
    },
  };
}

async function uploadSigned(
  config: TestConfiguration,
  upload: CreatedUpload['upload'],
  bytes: Uint8Array,
  contentType = 'image/jpeg',
): Promise<unknown> {
  const client = createClient(config.supabaseUrl, config.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { error } = await client.storage.from('photos').uploadToSignedUrl(
    upload.storagePath,
    upload.signedUploadToken,
    new Blob([Uint8Array.from(bytes)], { type: contentType }),
    { contentType },
  );
  return error;
}

async function patchPhotoSession(
  config: TestConfiguration,
  photoSessionId: string,
  values: JsonRecord,
): Promise<void> {
  const response = await serviceRequest(
    config,
    `/rest/v1/photo_sessions?id=eq.${encodeURIComponent(photoSessionId)}`,
    {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(values),
    },
  );
  await assertStatus(response, 204);
}

async function getPhotoSession(
  config: TestConfiguration,
  photoSessionId: string,
): Promise<JsonRecord> {
  const response = await serviceRequest(
    config,
    `/rest/v1/photo_sessions?id=eq.${encodeURIComponent(photoSessionId)}&select=*`,
  );
  await assertStatus(response, 200);
  const rows = await response.json() as unknown;
  assert(Array.isArray(rows) && rows.length === 1);
  assert(rows[0] && typeof rows[0] === 'object');
  return rows[0] as JsonRecord;
}

async function claimCleanup(
  config: TestConfiguration,
  photoSessionId: string,
  leaseId: string,
): Promise<JsonRecord> {
  const response = await serviceRequest(config, '/rest/v1/rpc/claim_photo_cleanup', {
    method: 'POST',
    body: JSON.stringify({ p_limit: 100, p_lease_id: leaseId }),
  });
  await assertStatus(response, 200);
  const rows = await response.json() as unknown;
  assert(Array.isArray(rows));
  const row = rows.find(
    (candidate) =>
      candidate && typeof candidate === 'object' &&
      (candidate as JsonRecord).id === photoSessionId,
  );
  assert(row && typeof row === 'object');
  return row as JsonRecord;
}

async function invokeCleanup(config: TestConfiguration): Promise<JsonRecord> {
  const response = await fetch(`${config.supabaseUrl}/functions/v1/cleanup-expired`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Cleanup-Secret': config.cleanupSecret },
    body: '{}',
  });
  await assertStatus(response, 200);
  return await readJson(response);
}

async function removeTestData(
  config: TestConfiguration,
  booths: BoothIdentity[],
  storagePaths: string[],
): Promise<void> {
  const admin = createClient(config.supabaseUrl, config.secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  if (storagePaths.length > 0) {
    await admin.storage.from('photos').remove([...new Set(storagePaths)]);
  }
  for (const booth of booths) {
    await serviceRequest(
      config,
      `/rest/v1/photo_sessions?owner_user_id=eq.${encodeURIComponent(booth.id)}`,
      { method: 'DELETE' },
    );
    await serviceRequest(
      config,
      `/rest/v1/booth_devices?user_id=eq.${encodeURIComponent(booth.id)}`,
      { method: 'DELETE' },
    );
    await serviceRequest(config, `/auth/v1/admin/users/${encodeURIComponent(booth.id)}`, {
      method: 'DELETE',
    });
  }
}

Deno.test({
  name: 'local Supabase photo delivery boundary',
  ignore: !RUN_INTEGRATION,
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(test) {
    const config = configuration();
    const booths: BoothIdentity[] = [];
    const storagePaths: string[] = [];
    const jpeg = minimalJpeg(1200, 3600);
    const jpegHash = await sha256Hex(jpeg);

    try {
      const boothOne = await createBooth(config, 'one');
      const boothTwo = await createBooth(config, 'two');
      booths.push(boothOne, boothTwo);

      await test.step('enforces booth allow-list and direct-access denial', async () => {
        await setBoothEnabled(config, boothTwo.id, false);
        const disabledBody = createBody(crypto.randomUUID(), jpeg, jpegHash);
        const disabled = await functionRequest(
          config,
          'create-upload',
          boothTwo.accessToken,
          disabledBody,
        );
        await assertStatus(disabled, 403);
        await setBoothEnabled(config, boothTwo.id, true);

        const direct = await fetch(`${config.supabaseUrl}/rest/v1/photo_sessions?select=id`, {
          headers: {
            apikey: config.publishableKey,
            Authorization: `Bearer ${boothOne.accessToken}`,
          },
        });
        assert(!direct.ok, 'A booth JWT unexpectedly read photo_sessions directly');
      });

      let readyUpload: CreatedUpload | null = null;
      await test.step('creates one stable capability under concurrent idempotent requests', async () => {
        const body = createBody(crypto.randomUUID(), jpeg, jpegHash);
        const responses = await Promise.all([
          functionRequest(config, 'create-upload', boothOne.accessToken, body),
          functionRequest(config, 'create-upload', boothOne.accessToken, body),
        ]);
        for (const response of responses) {
          await assertStatus(response, [200, 201]);
        }
        const first = asCreatedUpload(await readJson(responses[0]));
        const second = asCreatedUpload(await readJson(responses[1]));
        assertEquals(first.photoSessionId, second.photoSessionId);
        assertEquals(first.publicToken, second.publicToken);
        assertEquals(first.upload.storagePath, second.upload.storagePath);
        assertMatch(first.publicToken, /^[A-Za-z0-9_-]{43}$/u);
        assertEquals(first.upload.validForSeconds, 7200);
        storagePaths.push(first.upload.storagePath);
        readyUpload = first;

        const row = await getPhotoSession(config, first.photoSessionId);
        assert(typeof row.public_token_hash === 'string');
        assertNotEquals(row.public_token_hash, first.publicToken);
        assertEquals(row.storage_backend, 'supabase');

        const crossOwnerResume = await functionRequest(
          config,
          'create-upload',
          boothTwo.accessToken,
          { action: 'resume', photoSessionId: first.photoSessionId },
        );
        await assertStatus(crossOwnerResume, 404);
        const crossOwnerConfirm = await functionRequest(
          config,
          'confirm-upload',
          boothTwo.accessToken,
          { photoSessionId: first.photoSessionId, publicToken: first.publicToken },
        );
        await assertStatus(crossOwnerConfirm, 404);
      });

      await test.step('uploads, confirms, and serves only controlled responses', async () => {
        assert(readyUpload);
        assertEquals(await uploadSigned(config, readyUpload.upload, jpeg), null);

        const deniedStorage = await fetch(
          `${config.supabaseUrl}/storage/v1/object/authenticated/photos/${readyUpload.upload.storagePath}`,
          {
            headers: {
              apikey: config.publishableKey,
              Authorization: `Bearer ${boothOne.accessToken}`,
            },
          },
        );
        assert(!deniedStorage.ok, 'A booth JWT unexpectedly downloaded the private object');

        const confirmationBody = {
          photoSessionId: readyUpload.photoSessionId,
          publicToken: readyUpload.publicToken,
        };
        const confirmed = await functionRequest(
          config,
          'confirm-upload',
          boothOne.accessToken,
          confirmationBody,
        );
        await assertStatus(confirmed, 200);
        const receipt = await readJson(confirmed);
        const repeated = await functionRequest(
          config,
          'confirm-upload',
          boothOne.accessToken,
          confirmationBody,
        );
        await assertStatus(repeated, 200);
        const repeatedReceipt = await readJson(repeated);
        assertEquals(repeatedReceipt.readyAt, receipt.readyAt);
        assertEquals(repeatedReceipt.expiresAt, receipt.expiresAt);
        assert(typeof receipt.readyAt === 'string' && typeof receipt.expiresAt === 'string');
        assertEquals(
          Date.parse(receipt.expiresAt) - Date.parse(receipt.readyAt),
          720 * 60 * 60 * 1000,
        );

        const resolved = await publicPhotoRequest(config, 'resolve', readyUpload.publicToken);
        await assertStatus(resolved, 200);
        const image = await publicPhotoRequest(config, 'image', readyUpload.publicToken);
        await assertStatus(image, 200);
        assertEquals(image.headers.get('cache-control'), 'no-store, max-age=0');
        assertEquals(image.headers.get('content-type'), 'image/jpeg');
        assertEquals(new Uint8Array(await image.arrayBuffer()), jpeg);
        const download = await publicPhotoRequest(config, 'download', readyUpload.publicToken);
        await assertStatus(download, 200);
        assertMatch(download.headers.get('content-disposition') ?? '', /^attachment;/u);
        assertEquals(new Uint8Array(await download.arrayBuffer()), jpeg);
      });

      await test.step('enforces exact CORS, methods, and action paths', async () => {
        const preflight = await fetch(
          `${config.supabaseUrl}/functions/v1/photo/resolve`,
          {
            method: 'OPTIONS',
            headers: {
              Origin: config.publicOrigin,
              'Access-Control-Request-Method': 'POST',
              'Access-Control-Request-Headers': 'content-type',
            },
          },
        );
        // The hosted Function returns 204; the current local Edge Runtime may normalize an
        // otherwise equivalent empty preflight to a wildcard 200 before invoking the handler.
        await assertStatus(preflight, [200, 204]);
        const preflightOrigin = preflight.headers.get('access-control-allow-origin');
        assert(
          preflightOrigin === config.publicOrigin ||
            (preflight.status === 200 && preflightOrigin === '*'),
        );

        const forbiddenOrigin = await fetch(
          `${config.supabaseUrl}/functions/v1/photo/resolve`,
          {
            method: 'POST',
            headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: 'A'.repeat(43) }),
          },
        );
        await assertStatus(forbiddenOrigin, 403);

        const get = await fetch(`${config.supabaseUrl}/functions/v1/photo/resolve`, {
          headers: { Origin: config.publicOrigin },
        });
        await assertStatus(get, 405);
        const nested = await fetch(
          `${config.supabaseUrl}/functions/v1/photo/arbitrary/resolve`,
          {
            method: 'POST',
            headers: { Origin: config.publicOrigin, 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: 'A'.repeat(43) }),
          },
        );
        await assertStatus(nested, 404);
      });

      await test.step('rejects malformed bytes, mismatched hashes, and MIME types', async () => {
        const malformed = Uint8Array.from(jpeg);
        malformed[0] = 0x00;
        const malformedHash = await sha256Hex(malformed);
        const malformedCreate = await functionRequest(
          config,
          'create-upload',
          boothOne.accessToken,
          createBody(crypto.randomUUID(), malformed, malformedHash),
        );
        await assertStatus(malformedCreate, [200, 201]);
        const malformedUpload = asCreatedUpload(await readJson(malformedCreate));
        storagePaths.push(malformedUpload.upload.storagePath);
        assertEquals(await uploadSigned(config, malformedUpload.upload, malformed), null);
        const malformedConfirm = await functionRequest(
          config,
          'confirm-upload',
          boothOne.accessToken,
          {
            photoSessionId: malformedUpload.photoSessionId,
            publicToken: malformedUpload.publicToken,
          },
        );
        await assertStatus(malformedConfirm, 422);

        const mismatchCreate = await functionRequest(
          config,
          'create-upload',
          boothOne.accessToken,
          createBody(crypto.randomUUID(), jpeg, '0'.repeat(64)),
        );
        await assertStatus(mismatchCreate, [200, 201]);
        const mismatchUpload = asCreatedUpload(await readJson(mismatchCreate));
        storagePaths.push(mismatchUpload.upload.storagePath);
        assertEquals(await uploadSigned(config, mismatchUpload.upload, jpeg), null);
        const mismatchConfirm = await functionRequest(
          config,
          'confirm-upload',
          boothOne.accessToken,
          {
            photoSessionId: mismatchUpload.photoSessionId,
            publicToken: mismatchUpload.publicToken,
          },
        );
        await assertStatus(mismatchConfirm, 422);

        const mimeCreate = await functionRequest(
          config,
          'create-upload',
          boothOne.accessToken,
          createBody(crypto.randomUUID(), jpeg, jpegHash),
        );
        await assertStatus(mimeCreate, [200, 201]);
        const mimeUpload = asCreatedUpload(await readJson(mimeCreate));
        storagePaths.push(mimeUpload.upload.storagePath);
        assert(await uploadSigned(config, mimeUpload.upload, jpeg, 'image/png'));
      });

      await test.step('makes expired and unknown public responses equivalent', async () => {
        assert(readyUpload);
        const readyAt = new Date(Date.now() - 744 * 60 * 60 * 1000);
        const expiresAt = new Date(readyAt.getTime() + 720 * 60 * 60 * 1000);
        await patchPhotoSession(config, readyUpload.photoSessionId, {
          status: 'expired',
          ready_at: readyAt.toISOString(),
          expires_at: expiresAt.toISOString(),
        });
        const expired = await publicPhotoRequest(config, 'resolve', readyUpload.publicToken);
        const unknown = await publicPhotoRequest(config, 'resolve', 'Z'.repeat(43));
        assertEquals(expired.status, 404);
        assertEquals(unknown.status, 404);
        assertEquals(await expired.text(), await unknown.text());
      });

      await test.step('cleanup claim prevents confirmation and retries deletion idempotently', async () => {
        const cleanupClientSessionId = crypto.randomUUID();
        const cleanupBody = createBody(cleanupClientSessionId, jpeg, jpegHash);
        const cleanupCreate = await functionRequest(
          config,
          'create-upload',
          boothOne.accessToken,
          cleanupBody,
        );
        await assertStatus(cleanupCreate, [200, 201]);
        const cleanupUpload = asCreatedUpload(await readJson(cleanupCreate));
        storagePaths.push(cleanupUpload.upload.storagePath);
        assertEquals(await uploadSigned(config, cleanupUpload.upload, jpeg), null);
        await patchPhotoSession(config, cleanupUpload.photoSessionId, {
          updated_at: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
        });

        const leaseId = crypto.randomUUID();
        const claim = await claimCleanup(config, cleanupUpload.photoSessionId, leaseId);
        assertEquals(claim.previous_status, 'pending');
        const afterClaim = await getPhotoSession(config, cleanupUpload.photoSessionId);
        assertEquals(afterClaim.status, 'deleting');

        const lateConfirmation = await functionRequest(
          config,
          'confirm-upload',
          boothOne.accessToken,
          {
            photoSessionId: cleanupUpload.photoSessionId,
            publicToken: cleanupUpload.publicToken,
          },
        );
        await assertStatus(lateConfirmation, 409);

        await patchPhotoSession(config, cleanupUpload.photoSessionId, {
          cleanup_lease_until: new Date(Date.now() - 1000).toISOString(),
        });
        const firstCleanup = await invokeCleanup(config);
        assert(typeof firstCleanup.deleted === 'number' && firstCleanup.deleted >= 1);
        const deleted = await getPhotoSession(config, cleanupUpload.photoSessionId);
        assertEquals(deleted.status, 'deleted');
        const secondCleanup = await invokeCleanup(config);
        assertEquals(secondCleanup.failed, 0);

        const recoveredCreate = await functionRequest(
          config,
          'create-upload',
          boothOne.accessToken,
          cleanupBody,
        );
        await assertStatus(recoveredCreate, 200);
        const recoveredUpload = asCreatedUpload(await readJson(recoveredCreate));
        assertEquals(recoveredUpload.photoSessionId, cleanupUpload.photoSessionId);
        assertEquals(recoveredUpload.publicToken, cleanupUpload.publicToken);
        assertEquals(recoveredUpload.upload.storagePath, cleanupUpload.upload.storagePath);
        assertEquals(await uploadSigned(config, recoveredUpload.upload, jpeg), null);
        const recoveredConfirmation = await functionRequest(
          config,
          'confirm-upload',
          boothOne.accessToken,
          {
            photoSessionId: recoveredUpload.photoSessionId,
            publicToken: recoveredUpload.publicToken,
          },
        );
        await assertStatus(recoveredConfirmation, 200);
        const recoveredRow = await getPhotoSession(config, recoveredUpload.photoSessionId);
        assertEquals(recoveredRow.status, 'ready');
      });
    } finally {
      await removeTestData(config, booths, storagePaths);
    }
  },
});
