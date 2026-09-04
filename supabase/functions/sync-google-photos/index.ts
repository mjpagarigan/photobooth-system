import { errorResponse, jsonResponse, requestId } from '../_shared/http.ts';
import { createAdminClient } from '../_shared/supabase.ts';
import { readUploadedBytes } from '../confirm-upload/index.ts';
import {
  addMediaItemToAlbum,
  createAlbumInGooglePhotos,
  refreshGoogleAccessToken,
  uploadBytesToGooglePhotos,
} from '../_shared/google_photos.ts';

type ClaimedJob = {
  id: string;
  session_id: string;
  storage_object_path: string;
  storage_backend: 'supabase' | 'r2';
  attempt_count: number;
};

type GoogleConfigRow = {
  id: number;
  connected_email: string | null;
  album_id: string | null;
  album_title: string | null;
  album_share_url: string | null;
  refresh_token_encrypted: string | null;
  enabled: boolean;
};

export async function processGooglePhotosSyncQueue(
  admin = createAdminClient(),
): Promise<{ processed: number; succeeded: number; failed: number }> {
  // 1. Check if Google Photos sync is configured and enabled
  const { data: configData, error: configError } = await admin
    .from('google_photos_config')
    .select('*')
    .eq('id', 1)
    .maybeSingle();

  if (configError || !configData) {
    return { processed: 0, succeeded: 0, failed: 0 };
  }

  const config = configData as GoogleConfigRow;
  if (!config.enabled) {
    return { processed: 0, succeeded: 0, failed: 0 };
  }

  // 2. Claim batch of pending jobs
  const { data: claimedData, error: claimError } = await admin.rpc('claim_google_photos_sync', {
    p_batch_size: 5,
    p_lease_seconds: 60,
  });

  if (claimError || !claimedData || !Array.isArray(claimedData) || claimedData.length === 0) {
    return { processed: 0, succeeded: 0, failed: 0 };
  }

  const jobs = claimedData as ClaimedJob[];
  let succeeded = 0;
  let failed = 0;

  // Obtain access token (or mock token if in test environment)
  const clientId = Deno.env.get('GOOGLE_CLIENT_ID') || 'mock_client_id';
  const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET') || 'mock_client_secret';
  let accessToken = 'mock_access_token';

  if (config.refresh_token_encrypted && clientId !== 'mock_client_id') {
    try {
      accessToken = await refreshGoogleAccessToken(clientId, clientSecret, config.refresh_token_encrypted);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to refresh token';
      for (const job of jobs) {
        await admin.rpc('fail_google_photos_sync', {
          p_job_id: job.id,
          p_error_message: msg,
          p_backoff_seconds: 30,
        });
      }
      return { processed: jobs.length, succeeded: 0, failed: jobs.length };
    }
  } else if (!config.refresh_token_encrypted && clientId !== 'mock_client_id') {
    const missingTokenMsg = 'Google account is missing offline sync authorization. Please authorize Google in Kiosk Admin.';
    for (const job of jobs) {
      await admin.rpc('fail_google_photos_sync', {
        p_job_id: job.id,
        p_error_message: missingTokenMsg,
        p_backoff_seconds: 60,
      });
    }
    return { processed: jobs.length, succeeded: 0, failed: jobs.length };
  }

  // If album is not set yet, automatically create default shared album
  let activeAlbumId = config.album_id;
  if (!activeAlbumId && clientId !== 'mock_client_id' && accessToken !== 'mock_access_token') {
    try {
      const created = await createAlbumInGooglePhotos(
        accessToken,
        config.album_title || 'M.A.T. Photobooth Live Stream',
      );
      activeAlbumId = created.albumId;
      await admin
        .from('google_photos_config')
        .update({
          album_id: created.albumId,
          album_title: created.albumTitle,
          album_share_url: created.shareUrl,
          updated_at: new Date().toISOString(),
        })
        .eq('id', 1);
    } catch {
      // Fallback
    }
  }

  // 3. Process each claimed job
  for (const job of jobs) {
    try {
      const jpegBytes = await readUploadedBytes(admin, {
        storage_backend: job.storage_backend,
        storage_object_path: job.storage_object_path,
        content_type: 'image/jpeg',
      });

      const fileName = `photostrip_${job.session_id.slice(0, 8)}.jpg`;
      const uploadToken = await uploadBytesToGooglePhotos(accessToken, jpegBytes, fileName);
      const mediaId = await addMediaItemToAlbum(
        accessToken,
        activeAlbumId,
        uploadToken,
        `M.A.T. Photobooth - Session ${job.session_id}`,
      );

      await admin.rpc('complete_google_photos_sync', {
        p_job_id: job.id,
        p_google_media_id: mediaId,
      });

      succeeded++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Upload failed';
      const backoffSec = Math.min(300, 15 * Math.pow(2, Math.max(0, job.attempt_count - 1)));
      await admin.rpc('fail_google_photos_sync', {
        p_job_id: job.id,
        p_error_message: msg,
        p_backoff_seconds: backoffSec,
      });
      failed++;
    }
  }

  return { processed: jobs.length, succeeded, failed };
}

export async function handler(): Promise<Response> {
  const correlationId = requestId();
  try {
    const admin = createAdminClient();
    const result = await processGooglePhotosSyncQueue(admin);
    return jsonResponse(result, 200, {}, correlationId);
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}

if (import.meta.main) {
  Deno.serve(handler);
}
