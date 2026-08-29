import { assertEquals, assertRejects } from 'jsr:@std/assert@1';
import {
  addMediaItemToAlbum,
  createAlbumInGooglePhotos,
  listGooglePhotosAlbums,
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

Deno.test('createAlbumInGooglePhotos creates and shares album', async () => {
  const mockFetch: typeof fetch = (input, init) => {
    const url = String(input);
    if (url.endsWith('/v1/albums')) {
      assertEquals(init?.method, 'POST');
      return Promise.resolve(
        new Response(
          JSON.stringify({
            id: 'created_album_123',
            title: 'Ministry Fair 2026',
            productUrl: 'https://photos.google.com/lr/album/created_album_123',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );
    }
    if (url.includes(':share')) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            shareInfo: { shareableUrl: 'https://photos.app.goo.gl/share123' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );
    }
    return Promise.reject(new Error('Unknown url'));
  };

  const result = await createAlbumInGooglePhotos('token', 'Ministry Fair 2026', {
    fetchImpl: mockFetch,
  });

  assertEquals(result.albumId, 'created_album_123');
  assertEquals(result.albumTitle, 'Ministry Fair 2026');
  assertEquals(result.shareUrl, 'https://photos.app.goo.gl/share123');
});

Deno.test('listGooglePhotosAlbums returns array of albums', async () => {
  const mockFetch: typeof fetch = (_input, _init) => {
    return Promise.resolve(
      new Response(
        JSON.stringify({
          albums: [
            {
              id: 'album_1',
              title: 'First Album',
              productUrl: 'https://photos.google.com/album1',
              shareInfo: { shareableUrl: 'https://photos.app.goo.gl/alb1' },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
  };

  const albums = await listGooglePhotosAlbums('token', { fetchImpl: mockFetch });
  assertEquals(albums.length, 1);
  assertEquals(albums[0]?.title, 'First Album');
  assertEquals(albums[0]?.shareUrl, 'https://photos.app.goo.gl/alb1');
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

Deno.test('listGooglePhotosAlbums merges both user albums and shared albums without duplicates', async () => {
  const mockFetch: typeof fetch = (input) => {
    const url = String(input);
    if (url.includes('/v1/albums')) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            albums: [
              { id: 'alb_1', title: 'Album 1', productUrl: 'https://photos.google.com/1' },
              { id: 'alb_shared_dup', title: 'Shared Dup', productUrl: 'https://photos.google.com/dup' },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );
    }
    if (url.includes('/v1/sharedAlbums')) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            sharedAlbums: [
              { id: 'alb_shared_dup', title: 'Shared Dup', productUrl: 'https://photos.google.com/dup' },
              { id: 'alb_shared_2', title: 'Shared 2', productUrl: 'https://photos.google.com/2' },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );
    }
    return Promise.reject(new Error('Unknown url'));
  };

  const albums = await listGooglePhotosAlbums('token', { fetchImpl: mockFetch });
  assertEquals(albums.length, 3);
  assertEquals(albums.map((a) => a.id), ['alb_1', 'alb_shared_dup', 'alb_shared_2']);
});

Deno.test('resolveAlbumShareUrl throws ApiError when external album cannot be found', async () => {
  const mockFetch: typeof fetch = () => {
    return Promise.resolve(
      new Response(JSON.stringify({ albums: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  };

  await assertRejects(
    () => resolveAlbumShareUrl('token', 'https://photos.app.goo.gl/unknown_external', { fetchImpl: mockFetch }),
    Error,
    'Google Photos API requires the album to be created through the photobooth',
  );
});

