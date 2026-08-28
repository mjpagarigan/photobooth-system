import { ApiError } from './errors.ts';

export type GooglePhotosDependencies = {
  fetchImpl: typeof fetch;
};

const DEFAULT_DEPENDENCIES: GooglePhotosDependencies = {
  fetchImpl: fetch,
};

export async function refreshGoogleAccessToken(
  clientId: string,
  clientSecret: string,
  refreshToken: string,
  deps: GooglePhotosDependencies = DEFAULT_DEPENDENCIES,
): Promise<string> {
  const response = await deps.fetchImpl('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new ApiError(
      response.status === 401 || response.status === 400 ? 401 : 503,
      response.status === 401 || response.status === 400 ? 'unauthorized' : 'unavailable',
      `Google authentication failed: ${errText || response.statusText}`,
      response.status >= 500,
    );
  }

  const data = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) {
    throw new ApiError(500, 'internal_error', 'Google token response missing access_token.');
  }

  return data.access_token;
}

export async function uploadBytesToGooglePhotos(
  accessToken: string,
  jpegBytes: Uint8Array,
  fileName = 'photostrip.jpg',
  deps: GooglePhotosDependencies = DEFAULT_DEPENDENCIES,
): Promise<string> {
  const response = await deps.fetchImpl('https://photoslibrary.googleapis.com/v1/uploads', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/octet-stream',
      'X-Goog-Upload-Content-Type': 'image/jpeg',
      'X-Goog-Upload-Protocol': 'raw',
      'X-Goog-Upload-File-Name': fileName,
    },
    body: jpegBytes as unknown as BodyInit,
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new ApiError(
      response.status === 429 ? 429 : response.status >= 500 ? 503 : 400,
      response.status === 429 ? 'rate_limited' : response.status >= 500 ? 'unavailable' : 'invalid_request',
      `Google Photos upload failed: ${errText || response.statusText}`,
      response.status === 429 || response.status >= 500,
    );
  }

  const uploadToken = (await response.text()).trim();
  if (!uploadToken) {
    throw new ApiError(500, 'internal_error', 'Google Photos upload returned empty token.');
  }

  return uploadToken;
}

export async function addMediaItemToAlbum(
  accessToken: string,
  albumId: string,
  uploadToken: string,
  description = 'M.A.T. Photobooth Strip',
  deps: GooglePhotosDependencies = DEFAULT_DEPENDENCIES,
): Promise<string> {
  const response = await deps.fetchImpl('https://photoslibrary.googleapis.com/v1/mediaItems:batchCreate', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      albumId,
      newMediaItems: [
        {
          description,
          simpleMediaItem: {
            uploadToken,
            fileName: 'photostrip.jpg',
          },
        },
      ],
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new ApiError(
      response.status === 429 ? 429 : response.status >= 500 ? 503 : 400,
      response.status === 429 ? 'rate_limited' : response.status >= 500 ? 'unavailable' : 'invalid_request',
      `Google Photos batchCreate failed: ${errText || response.statusText}`,
      response.status === 429 || response.status >= 500,
    );
  }

  const data = (await response.json()) as {
    newMediaItemResults?: Array<{
      status?: { message?: string; code?: number };
      mediaItem?: { id?: string; productUrl?: string };
    }>;
  };

  const firstResult = data.newMediaItemResults?.[0];
  if (!firstResult) {
    throw new ApiError(500, 'internal_error', 'Empty result from Google Photos batchCreate.');
  }

  if (firstResult.status && firstResult.status.message && firstResult.status.message.toLowerCase() !== 'success') {
    throw new ApiError(
      400,
      'invalid_request',
      `Google Photos item creation error: ${firstResult.status.message}`,
    );
  }

  return firstResult.mediaItem?.id ?? 'synced_item';
}

export async function resolveAlbumShareUrl(
  accessToken: string,
  shareUrl: string,
  deps: GooglePhotosDependencies = DEFAULT_DEPENDENCIES,
): Promise<{ albumId: string; albumTitle: string; shareUrl: string }> {
  // If the input is already a direct Google album ID
  if (!shareUrl.startsWith('http://') && !shareUrl.startsWith('https://')) {
    const albumRes = await deps.fetchImpl(`https://photoslibrary.googleapis.com/v1/albums/${shareUrl}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (albumRes.ok) {
      const album = (await albumRes.json()) as { id: string; title?: string; shareInfo?: { shareableUrl?: string } };
      return {
        albumId: album.id,
        albumTitle: album.title || 'Shared Album',
        shareUrl: album.shareInfo?.shareableUrl || shareUrl,
      };
    }
  }

  // Query user's albums list to match or find
  const listRes = await deps.fetchImpl('https://photoslibrary.googleapis.com/v1/albums?pageSize=50', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (listRes.ok) {
    const listData = (await listRes.json()) as {
      albums?: Array<{ id: string; title?: string; shareInfo?: { shareableUrl?: string } }>;
    };
    if (listData.albums && listData.albums.length > 0) {
      // Check if any album matches the share URL
      const found = listData.albums.find(
        (a) => a.shareInfo?.shareableUrl === shareUrl || a.id === shareUrl,
      );
      if (found) {
        return {
          albumId: found.id,
          albumTitle: found.title || 'Shared Album',
          shareUrl: found.shareInfo?.shareableUrl || shareUrl,
        };
      }
      // Default to matching first album or returning validated input
      const first = listData.albums[0]!;
      return {
        albumId: first.id,
        albumTitle: first.title || 'Shared Album',
        shareUrl,
      };
    }
  }

  return {
    albumId: shareUrl.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) || 'default_album',
    albumTitle: 'Google Photos Shared Album',
    shareUrl,
  };
}
