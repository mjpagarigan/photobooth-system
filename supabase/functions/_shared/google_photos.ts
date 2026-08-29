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

export async function createAlbumInGooglePhotos(
  accessToken: string,
  title: string,
  deps: GooglePhotosDependencies = DEFAULT_DEPENDENCIES,
): Promise<{ albumId: string; albumTitle: string; shareUrl: string; productUrl?: string | undefined }> {
  const createRes = await deps.fetchImpl('https://photoslibrary.googleapis.com/v1/albums', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      album: {
        title,
      },
    }),
  });

  if (!createRes.ok) {
    const errText = await createRes.text().catch(() => '');
    throw new ApiError(
      createRes.status === 429 ? 429 : createRes.status >= 500 ? 503 : 400,
      createRes.status === 429 ? 'rate_limited' : createRes.status >= 500 ? 'unavailable' : 'invalid_request',
      `Google Photos album creation failed: ${errText || createRes.statusText}`,
      createRes.status === 429 || createRes.status >= 500,
    );
  }

  const album = (await createRes.json()) as { id: string; title?: string; productUrl?: string };
  let shareUrl = album.productUrl || '';

  // Attempt to enable public album sharing for guests
  try {
    const shareRes = await deps.fetchImpl(`https://photoslibrary.googleapis.com/v1/albums/${album.id}:share`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sharedAlbumOptions: {
          isCollaborative: false,
          isCommentable: true,
        },
      }),
    });
    if (shareRes.ok) {
      const shareData = (await shareRes.json()) as {
        shareInfo?: { shareableUrl?: string };
      };
      if (shareData.shareInfo?.shareableUrl) {
        shareUrl = shareData.shareInfo.shareableUrl;
      }
    }
  } catch {
    // Non-fatal fallback to productUrl
  }

  return {
    albumId: album.id,
    albumTitle: album.title || title,
    shareUrl: shareUrl || album.productUrl || '',
    productUrl: album.productUrl,
  };
}

export async function listGooglePhotosAlbums(
  accessToken: string,
  deps: GooglePhotosDependencies = DEFAULT_DEPENDENCIES,
): Promise<Array<{ id: string; title: string; shareUrl?: string | undefined; productUrl?: string | undefined }>> {
  const albums: Array<{ id: string; title: string; shareUrl?: string | undefined; productUrl?: string | undefined }> = [];
  const seenIds = new Set<string>();

  // 1. Fetch user/app created albums
  try {
    const res = await deps.fetchImpl('https://photoslibrary.googleapis.com/v1/albums?pageSize=50', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (res.ok) {
      const data = (await res.json()) as {
        albums?: Array<{ id: string; title?: string; productUrl?: string; shareInfo?: { shareableUrl?: string } }>;
      };
      if (data.albums) {
        for (const a of data.albums) {
          if (a.id && !seenIds.has(a.id)) {
            seenIds.add(a.id);
            albums.push({
              id: a.id,
              title: a.title || 'Untitled Album',
              shareUrl: a.shareInfo?.shareableUrl || a.productUrl,
              productUrl: a.productUrl,
            });
          }
        }
      }
    }
  } catch {
    // Fallback
  }

  // 2. Fetch shared albums
  try {
    const resShared = await deps.fetchImpl('https://photoslibrary.googleapis.com/v1/sharedAlbums?pageSize=50', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (resShared.ok) {
      const data = (await resShared.json()) as {
        sharedAlbums?: Array<{ id: string; title?: string; productUrl?: string; shareInfo?: { shareableUrl?: string } }>;
      };
      if (data.sharedAlbums) {
        for (const a of data.sharedAlbums) {
          if (a.id && !seenIds.has(a.id)) {
            seenIds.add(a.id);
            albums.push({
              id: a.id,
              title: a.title || 'Shared Album',
              shareUrl: a.shareInfo?.shareableUrl || a.productUrl,
              productUrl: a.productUrl,
            });
          }
        }
      }
    }
  } catch {
    // Fallback
  }

  return albums;
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
  albumId: string | null | undefined,
  uploadToken: string,
  description = 'M.A.T. Photobooth Strip',
  deps: GooglePhotosDependencies = DEFAULT_DEPENDENCIES,
): Promise<string> {
  const cleanAlbumId = albumId ? albumId.trim() : null;
  const payload: Record<string, unknown> = {
    newMediaItems: [
      {
        description,
        simpleMediaItem: {
          uploadToken,
          fileName: 'photostrip.jpg',
        },
      },
    ],
  };

  if (cleanAlbumId && cleanAlbumId.length > 0) {
    payload.albumId = cleanAlbumId;
  }

  const response = await deps.fetchImpl('https://photoslibrary.googleapis.com/v1/mediaItems:batchCreate', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new ApiError(
      response.status === 429 ? 429 : response.status >= 500 ? 503 : 400,
      response.status === 429 ? 'rate_limited' : response.status >= 500 ? 'unavailable' : 'invalid_request',
      `Google Photos batchCreate failed (${response.status}): ${errText || response.statusText}`,
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
  const trimmed = shareUrl.trim();

  // 1. If the input is already a direct Google album ID
  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
    try {
      const albumRes = await deps.fetchImpl(`https://photoslibrary.googleapis.com/v1/albums/${trimmed}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (albumRes.ok) {
        const album = (await albumRes.json()) as { id: string; title?: string; shareInfo?: { shareableUrl?: string }; productUrl?: string };
        return {
          albumId: album.id,
          albumTitle: album.title || 'Shared Album',
          shareUrl: album.shareInfo?.shareableUrl || album.productUrl || trimmed,
        };
      }
    } catch {
      // Continue to search
    }
  }

  // 2. Query user's albums and shared albums list
  try {
    const albums = await listGooglePhotosAlbums(accessToken, deps);
    if (albums.length > 0) {
      const found = albums.find(
        (a) => a.shareUrl === trimmed || a.productUrl === trimmed || a.id === trimmed,
      );
      if (found) {
        return {
          albumId: found.id,
          albumTitle: found.title || 'Shared Album',
          shareUrl: found.shareUrl || found.productUrl || trimmed,
        };
      }
    }
  } catch {
    // Continue
  }

  // If still not matched, explain to the operator that albums must be created via the Photobooth
  throw new ApiError(
    400,
    'invalid_request',
    'Could not resolve album. Google Photos API requires the album to be created through the photobooth so photos can be streamed into it. Please click "Create & Select" under "Create new shared event album".',
  );
}
