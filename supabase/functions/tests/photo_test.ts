import { assertEquals, assertFalse, assertStringIncludes } from 'jsr:@std/assert@1.0.14';
import type { AdminClient } from '../_shared/supabase.ts';
import { handler, type PhotoHandlerDependencies } from '../photo/index.ts';

const TOKEN = 'A'.repeat(43);
const PAGE_ORIGIN = 'https://photos.example.test';
const NOW = Date.parse('2026-08-24T00:00:00.000Z');

type ResolvedRow = {
  id: string;
  storage_object_path: string;
  storage_backend: 'supabase' | 'r2';
  content_type: 'image/jpeg';
  byte_size: number;
  google_forms_url: null;
  expires_at: string;
};

const PHOTO: ResolvedRow = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  storage_object_path: '2026/08/private-photo.jpg',
  storage_backend: 'r2',
  content_type: 'image/jpeg',
  byte_size: 6,
  google_forms_url: null,
  expires_at: new Date(NOW + 10 * 60_000).toISOString(),
};

function request(
  route: 'resolve' | 'image' | 'download',
  body: unknown = { token: TOKEN },
): Request {
  return new Request(`https://api.example.test/functions/v1/photo/${route}`, {
    method: 'POST',
    headers: { Origin: PAGE_ORIGIN, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function adminClient(
  rows: (ResolvedRow | null)[] = [PHOTO, PHOTO],
  jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0xff, 0xd9]),
): { client: AdminClient; rpcCalls: () => number } {
  let calls = 0;
  const client = {
    rpc() {
      const row = rows[calls] ?? null;
      calls += 1;
      return Promise.resolve({ data: row ? [row] : [], error: null });
    },
    storage: {
      from() {
        return {
          download() {
            return Promise.resolve({
              data: new Blob([jpeg], { type: 'image/jpeg' }),
              error: null,
            });
          },
        };
      },
    },
  } as unknown as AdminClient;
  return { client, rpcCalls: () => calls };
}

function dependencies(
  admin: AdminClient,
  overrides: Partial<PhotoHandlerDependencies> = {},
): PhotoHandlerDependencies {
  return {
    publicPageOrigin: () => PAGE_ORIGIN,
    createAdminClient: () => admin,
    isR2Configured: () => true,
    createR2Client: () =>
      ({
        send: () =>
          Promise.resolve({
            Body: {
              transformToByteArray: () =>
                Promise.resolve(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0xff, 0xd9])),
            },
          }),
      }) as unknown as ReturnType<PhotoHandlerDependencies['createR2Client']>,
    checkR2ObjectExists: () => Promise.resolve({ exists: true, byteSize: PHOTO.byte_size }),
    createR2PresignedGetUrl: () =>
      Promise.resolve(
        'https://bucket.account.r2.cloudflarestorage.com/signed.jpg?X-Amz-Signature=one',
      ),
    hashPublicToken: () => Promise.resolve('a'.repeat(64)),
    photoBucket: () => 'photos',
    r2BucketName: () => 'private-photos',
    now: () => NOW,
    ...overrides,
  };
}

Deno.test('R2 image and download requests return fresh JPEG bytes with CORS headers', async () => {
  const admin = adminClient([PHOTO, PHOTO, PHOTO, PHOTO]);
  const deps = dependencies(admin.client);

  const image = await handler(request('image'), deps);
  const download = await handler(request('download'), deps);

  assertEquals(image.status, 200);
  assertEquals(download.status, 200);
  assertEquals(image.headers.get('content-type'), 'image/jpeg');
  assertEquals(download.headers.get('content-type'), 'image/jpeg');
  assertEquals(
    download.headers.get('content-disposition'),
    'attachment; filename="mat-photobooth-keepsake.jpg"',
  );
  assertEquals((await image.arrayBuffer()).byteLength, PHOTO.byte_size);
  assertEquals((await download.arrayBuffer()).byteLength, PHOTO.byte_size);
  assertEquals(admin.rpcCalls(), 4);
});

Deno.test('resolve remains metadata-only even when R2 delivery is configured', async () => {
  const admin = adminClient([PHOTO]);
  let storageChecked = false;
  const response = await handler(
    request('resolve'),
    dependencies(admin.client, {
      checkR2ObjectExists: () => {
        storageChecked = true;
        return Promise.resolve({ exists: true, byteSize: PHOTO.byte_size });
      },
    }),
  );
  assertEquals(response.status, 200);
  assertEquals(storageChecked, false);
  assertEquals(await response.json(), {
    status: 'ready',
    expiresAt: PHOTO.expires_at,
    googleFormsUrl: null,
  });
  assertEquals(admin.rpcCalls(), 1);
});

Deno.test('R2 delivery rejects expired token', async () => {
  const expired = { ...PHOTO, expires_at: new Date(NOW - 1_000).toISOString() };
  const admin = adminClient([expired, expired]);
  const response = await handler(request('image'), dependencies(admin.client));
  assertEquals(response.status, 404);
});

Deno.test('R2 delivery rejects missing, mismatched, and freshly unauthorized objects', async () => {
  for (
    const object of [
      { exists: false, byteSize: null },
      { exists: true, byteSize: PHOTO.byte_size + 1 },
    ]
  ) {
    const admin = adminClient();
    let signed = false;
    const response = await handler(
      request('image'),
      dependencies(admin.client, {
        checkR2ObjectExists: () => Promise.resolve(object),
        createR2PresignedGetUrl: () => {
          signed = true;
          return Promise.resolve('https://r2.example/signed');
        },
      }),
    );
    assertEquals(response.status, object.exists ? 503 : 404);
    assertEquals(signed, false);
  }

  const reauthorization = adminClient([PHOTO, null]);
  const response = await handler(request('download'), dependencies(reauthorization.client));
  assertEquals(response.status, 404);
});

Deno.test('photo routes reject an absent token before storage or signing', async () => {
  const admin = adminClient();
  let signed = false;
  const response = await handler(
    request('image', {}),
    dependencies(admin.client, {
      createR2PresignedGetUrl: () => {
        signed = true;
        return Promise.resolve('https://r2.example/signed');
      },
    }),
  );
  assertEquals(response.status, 400);
  assertEquals(admin.rpcCalls(), 0);
  assertEquals(signed, false);
});

Deno.test('Supabase binary fallback remains size-checked and reauthorized', async () => {
  const supabasePhoto = { ...PHOTO, storage_backend: 'supabase' as const };
  const admin = adminClient([supabasePhoto, supabasePhoto]);
  const response = await handler(
    request('download'),
    dependencies(admin.client),
  );
  assertEquals(response.status, 200);
  assertEquals(response.headers.get('content-type'), 'image/jpeg');
  assertEquals(
    response.headers.get('content-disposition'),
    'attachment; filename="mat-photobooth-keepsake.jpg"',
  );
  assertEquals((await response.arrayBuffer()).byteLength, PHOTO.byte_size);
  assertEquals(admin.rpcCalls(), 2);
});
