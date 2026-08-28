import { assertEquals, assertRejects } from 'jsr:@std/assert@1';
import {
  addMediaItemToAlbum,
  refreshGoogleAccessToken,
  resolveAlbumShareUrl,
  uploadBytesToGooglePhotos,
} from '../_shared/google_photos.ts';

Deno.test('refreshGoogleAccessToken parses valid access token response', async () => {
  const mockFetch: typeof fetch = (_input, _init) => {
    return Promise.resolve(
      new Response(JSON.stringify({ access_token: 'test_token_123', expires_in: 3600 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  };

  const token = await refreshGoogleAccessToken('cid', 'csec', 'rtoken', { fetchImpl: mockFetch });
  assertEquals(token, 'test_token_123');
});

Deno.test('refreshGoogleAccessToken rejects invalid credentials with 401', async () => {
  const mockFetch: typeof fetch = (_input, _init) => {
    return Promise.resolve(
      new Response(JSON.stringify({ error: 'invalid_grant' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  };

  await assertRejects(
    () => refreshGoogleAccessToken('cid', 'csec', 'invalid_token', { fetchImpl: mockFetch }),
    Error,
  );
});

Deno.test('uploadBytesToGooglePhotos streams bytes and returns upload token', async () => {
  const mockFetch: typeof fetch = (_input, init) => {
    assertEquals(init?.method, 'POST');
    assertEquals(init?.headers ? (init.headers as Record<string, string>)['X-Goog-Upload-Protocol'] : null, 'raw');
    return Promise.resolve(new Response('upload_token_abc_xyz', { status: 200 }));
  };

  const dummyBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
  const token = await uploadBytesToGooglePhotos('access_token_123', dummyBytes, 'photostrip.jpg', {
    fetchImpl: mockFetch,
  });
  assertEquals(token, 'upload_token_abc_xyz');
});

Deno.test('addMediaItemToAlbum creates media item in album', async () => {
  const mockFetch: typeof fetch = (_input, init) => {
    assertEquals(init?.method, 'POST');
    return Promise.resolve(
      new Response(
        JSON.stringify({
          newMediaItemResults: [
            {
              status: { message: 'Success' },
              mediaItem: { id: 'media_item_999' },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
  };

  const mediaId = await addMediaItemToAlbum(
    'access_token_123',
    'album_id_456',
    'upload_token_abc',
    'Test Photo',
    { fetchImpl: mockFetch },
  );
  assertEquals(mediaId, 'media_item_999');
});

Deno.test('resolveAlbumShareUrl resolves share URL to album title and ID', async () => {
  const mockFetch: typeof fetch = (_input, _init) => {
    return Promise.resolve(
      new Response(
        JSON.stringify({
          albums: [
            {
              id: 'album_123',
              title: 'Sunday Service 2026',
              shareInfo: { shareableUrl: 'https://photos.app.goo.gl/xyz123' },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
  };

  const resolved = await resolveAlbumShareUrl('token', 'https://photos.app.goo.gl/xyz123', {
    fetchImpl: mockFetch,
  });
  assertEquals(resolved.albumId, 'album_123');
  assertEquals(resolved.albumTitle, 'Sunday Service 2026');
});
