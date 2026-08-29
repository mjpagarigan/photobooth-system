import { errorResponse, jsonResponse, readJson, requestId } from '../_shared/http.ts';
import { authenticateBooth, createAdminClient } from '../_shared/supabase.ts';
import {
  addMediaItemToAlbum,
  createAlbumInGooglePhotos,
  listGooglePhotosAlbums,
  refreshGoogleAccessToken,
  resolveAlbumShareUrl,
  uploadBytesToGooglePhotos,
} from '../_shared/google_photos.ts';
import { ApiError } from '../_shared/errors.ts';
import { processGooglePhotosSyncQueue } from '../sync-google-photos/index.ts';

const OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/photoslibrary',
  'https://www.googleapis.com/auth/photoslibrary.sharing',
  'https://www.googleapis.com/auth/photoslibrary.appendonly',
  'https://www.googleapis.com/auth/photoslibrary.readonly.appcreateddata',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ');

export async function handler(request: Request): Promise<Response> {
  const correlationId = requestId();
  const url = new URL(request.url);

  // 1. Handle OAuth 2.0 Web Redirect Callback (GET /functions/v1/google-photos-auth?code=...)
  if (request.method === 'GET') {
    const code = url.searchParams.get('code');
    const error = url.searchParams.get('error');

    if (error) {
      return new Response(
        `<!DOCTYPE html>
<html>
<head><title>Google Photos Authorization Failed</title><style>body{font-family:sans-serif;background:#09090b;color:#f4f4f5;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;}div{text-align:center;background:#18181b;padding:2.5rem;border-radius:1rem;border:1px solid #ef4444;max-width:440px;}</style></head>
<body>
<div>
<h2 style="color:#ef4444;margin-top:0;">✕ Authorization Failed</h2>
<p style="color:#a1a1aa;">${error}</p>
<p style="color:#71717a;font-size:0.875rem;">Please close this window and try again in Kiosk Admin.</p>
</div>
</body>
</html>`,
        { headers: { 'content-type': 'text/html; charset=utf-8' }, status: 400 },
      );
    }
    if (!code && !error) {
      const clientId = Deno.env.get('GOOGLE_CLIENT_ID') || '';
      const supabaseUrl = Deno.env.get('SUPABASE_URL') || 'https://bejgkclvsfbkpkflftxu.supabase.co';
      const redirectUri = `${supabaseUrl.replace(/\/$/, '')}/functions/v1/google-photos-auth`;
      const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(
        redirectUri,
      )}&response_type=code&scope=${encodeURIComponent(OAUTH_SCOPES)}&access_type=offline&prompt=consent`;
      return Response.redirect(authUrl, 302);
    }

    if (code) {
      try {
        const clientId = Deno.env.get('GOOGLE_CLIENT_ID') || '';
        const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET') || '';
        const supabaseUrl = Deno.env.get('SUPABASE_URL') || 'https://bejgkclvsfbkpkflftxu.supabase.co';
        const redirectUri = `${supabaseUrl.replace(/\/$/, '')}/functions/v1/google-photos-auth`;

        const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            code,
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: redirectUri,
            grant_type: 'authorization_code',
          }),
        });

        const tokenData = await tokenRes.json();
        if (tokenData.error) {
          throw new Error(tokenData.error_description || tokenData.error);
        }

        let email: string | null = null;
        if (tokenData.access_token) {
          const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
            headers: { authorization: `Bearer ${tokenData.access_token}` },
          });
          const userData = await userRes.json();
          email = userData.email || null;
        }

        const admin = createAdminClient();
        const { data: existingConfig } = await admin
          .from('google_photos_config')
          .select('refresh_token_encrypted, album_id, album_title, album_share_url, enabled')
          .eq('id', 1)
          .maybeSingle();

        const refreshTokenToSave =
          tokenData.refresh_token || existingConfig?.refresh_token_encrypted || null;

        if (existingConfig) {
          await admin
            .from('google_photos_config')
            .update({
              connected_email: email,
              refresh_token_encrypted: refreshTokenToSave,
              enabled: true,
              updated_at: new Date().toISOString(),
            })
            .eq('id', 1);
        } else {
          await admin.from('google_photos_config').insert({
            id: 1,
            connected_email: email,
            refresh_token_encrypted: refreshTokenToSave,
            enabled: true,
            updated_at: new Date().toISOString(),
          });
        }

        return new Response(
          `<!DOCTYPE html>
<html>
<head><title>Google Photos Connected</title><style>body{font-family:system-ui,-apple-system,sans-serif;background:#09090b;color:#f4f4f5;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;}div{text-align:center;background:#18181b;padding:2.5rem;border-radius:1rem;border:1px solid #27272a;box-shadow:0 25px 50px -12px rgba(0,0,0,0.5);max-width:440px;}h2{color:#22c55e;margin-top:0;}p{color:#d4d4d8;font-size:1rem;line-height:1.5;}.sub{color:#a1a1aa;font-size:0.875rem;margin-top:1.5rem;}</style></head>
<body>
<div>
<h2>✓ Google Photos Connected!</h2>
<p>Successfully authorized account:<br><strong style="color:#ffffff;">${email || 'Google Account'}</strong></p>
<p class="sub">You can now return to the Photobooth Kiosk Admin settings.</p>
</div>
</body>
</html>`,
          { headers: { 'content-type': 'text/html; charset=utf-8' }, status: 200 },
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Token exchange failed';
        return new Response(
          `<!DOCTYPE html>
<html>
<head><title>Connection Error</title><style>body{font-family:sans-serif;background:#09090b;color:#f4f4f5;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;}div{text-align:center;background:#18181b;padding:2.5rem;border-radius:1rem;border:1px solid #ef4444;max-width:440px;}</style></head>
<body>
<div>
<h2 style="color:#ef4444;margin-top:0;">✕ Connection Error</h2>
<p style="color:#a1a1aa;">${msg}</p>
<p style="color:#71717a;font-size:0.875rem;">Please close this window and try again.</p>
</div>
</body>
</html>`,
          { headers: { 'content-type': 'text/html; charset=utf-8' }, status: 500 },
        );
      }
    }
  }

  // 2. Handle POST API requests
  try {
    const admin = createAdminClient();
    await authenticateBooth(request, admin);

    const body = (await readJson(request)) as Record<string, unknown>;
    const action = String(body.action || 'get-status');

    if (action === 'get-status') {
      const { data: configData } = await admin
        .from('google_photos_config')
        .select('connected_email, album_id, album_title, album_share_url, refresh_token_encrypted, enabled')
        .eq('id', 1)
        .maybeSingle();

      const { data: statsData } = await admin.rpc('get_google_photos_sync_stats');
      const statsRow = Array.isArray(statsData) && statsData.length > 0 ? statsData[0] : null;

      const clientId = Deno.env.get('GOOGLE_CLIENT_ID');
      const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET');
      const supabaseUrl = Deno.env.get('SUPABASE_URL') || 'https://bejgkclvsfbkpkflftxu.supabase.co';
      const redirectUri = `${supabaseUrl.replace(/\/$/, '')}/functions/v1/google-photos-auth`;
      const authUrl = clientId
        ? `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(
            redirectUri,
          )}&response_type=code&scope=${encodeURIComponent(OAUTH_SCOPES)}&access_type=offline&prompt=consent`
        : null;

      return jsonResponse(
        {
          config: {
            connectedEmail: configData?.connected_email ?? null,
            albumId: configData?.album_id ?? null,
            albumTitle: configData?.album_title ?? null,
            albumShareUrl: configData?.album_share_url ?? null,
            enabled: Boolean(configData?.enabled),
          },
          stats: {
            syncedCount: Number(statsRow?.synced_count ?? 0),
            pendingCount: Number(statsRow?.pending_count ?? 0),
            failedCount: Number(statsRow?.failed_count ?? 0),
            lastSyncedAt: statsRow?.last_synced_at ? new Date(statsRow.last_synced_at).getTime() : null,
          },
          hasRefreshToken: Boolean(configData?.refresh_token_encrypted),
          hasCredentials: Boolean(clientId && clientSecret),
          authUrl,
        },
        200,
        {},
        correlationId,
      );
    }

    if (action === 'save-config') {
      const configInput = (body.config || {}) as Record<string, unknown>;
      const updateData: Record<string, unknown> = {
        connected_email: configInput.connectedEmail ? String(configInput.connectedEmail) : null,
        album_id: configInput.albumId ? String(configInput.albumId) : null,
        album_title: configInput.albumTitle ? String(configInput.albumTitle) : null,
        album_share_url: configInput.albumShareUrl ? String(configInput.albumShareUrl) : null,
        enabled: Boolean(configInput.enabled),
        updated_at: new Date().toISOString(),
      };

      const { data: existing } = await admin
        .from('google_photos_config')
        .select('id')
        .eq('id', 1)
        .maybeSingle();

      if (existing) {
        await admin.from('google_photos_config').update(updateData).eq('id', 1);
      } else {
        await admin.from('google_photos_config').insert({ id: 1, ...updateData });
      }

      return jsonResponse({ ok: true, data: configInput }, 200, {}, correlationId);
    }

    if (action === 'create-album') {
      const title = String(body.title || 'M.A.T. Photobooth').trim();
      const { data: configData } = await admin
        .from('google_photos_config')
        .select('refresh_token_encrypted')
        .eq('id', 1)
        .maybeSingle();

      const clientId = Deno.env.get('GOOGLE_CLIENT_ID');
      const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET');

      if (!clientId || !clientSecret) {
        throw new ApiError(
          500,
          'internal_error',
          'GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET is missing in Supabase Edge Function environment secrets.',
        );
      }

      if (!configData?.refresh_token_encrypted) {
        throw new ApiError(
          400,
          'unauthorized',
          'Google account is missing offline sync authorization. Please click "Authorize Google Account" in Kiosk Admin.',
        );
      }

      const accessToken = await refreshGoogleAccessToken(clientId, clientSecret, configData.refresh_token_encrypted);
      const created = await createAlbumInGooglePhotos(accessToken, title);

      await admin
        .from('google_photos_config')
        .update({
          album_id: created.albumId,
          album_title: created.albumTitle,
          album_share_url: created.shareUrl,
          updated_at: new Date().toISOString(),
        })
        .eq('id', 1);

      return jsonResponse({ ok: true, data: created }, 200, {}, correlationId);
    }

    if (action === 'list-albums') {
      const { data: configData } = await admin
        .from('google_photos_config')
        .select('refresh_token_encrypted')
        .eq('id', 1)
        .maybeSingle();

      const clientId = Deno.env.get('GOOGLE_CLIENT_ID');
      const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET');

      if (!clientId || !clientSecret) {
        throw new ApiError(
          500,
          'internal_error',
          'GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET is missing in Supabase Edge Function environment secrets.',
        );
      }

      if (!configData?.refresh_token_encrypted) {
        throw new ApiError(
          400,
          'unauthorized',
          'Google account is missing offline sync authorization. Please click "Authorize Google Account" in Kiosk Admin.',
        );
      }

      const accessToken = await refreshGoogleAccessToken(clientId, clientSecret, configData.refresh_token_encrypted);
      const albums = await listGooglePhotosAlbums(accessToken);
      return jsonResponse({ ok: true, data: { albums } }, 200, {}, correlationId);
    }

    if (action === 'resolve-album') {
      const shareUrl = String(body.shareUrl || '').trim();
      const { data: configData } = await admin
        .from('google_photos_config')
        .select('refresh_token_encrypted')
        .eq('id', 1)
        .maybeSingle();

      let token = 'mock_access_token';
      const clientId = Deno.env.get('GOOGLE_CLIENT_ID');
      const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET');

      if (configData?.refresh_token_encrypted && clientId && clientSecret) {
        try {
          token = await refreshGoogleAccessToken(clientId, clientSecret, configData.refresh_token_encrypted);
        } catch {
          // Fall back to URL resolution
        }
      }

      const resolved = await resolveAlbumShareUrl(token, shareUrl);
      return jsonResponse({ ok: true, data: resolved }, 200, {}, correlationId);
    }

    if (action === 'test-upload') {
      const { data: configData } = await admin
        .from('google_photos_config')
        .select('*')
        .eq('id', 1)
        .maybeSingle();

      const clientId = Deno.env.get('GOOGLE_CLIENT_ID');
      const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET');

      if (!configData?.refresh_token_encrypted || !clientId || !clientSecret) {
        return jsonResponse(
          { ok: true, data: { success: false, message: 'Google account not connected or OAuth credentials missing.' } },
          200,
          {},
          correlationId,
        );
      }

      try {
        const accessToken = await refreshGoogleAccessToken(clientId, clientSecret, configData.refresh_token_encrypted);

        let albumId = configData.album_id;
        let albumTitle = configData.album_title;

        if (!albumId) {
          const created = await createAlbumInGooglePhotos(accessToken, albumTitle || 'M.A.T. Photobooth');
          albumId = created.albumId;
          albumTitle = created.albumTitle;

          await admin
            .from('google_photos_config')
            .update({
              album_id: albumId,
              album_title: albumTitle,
              album_share_url: created.shareUrl,
              updated_at: new Date().toISOString(),
            })
            .eq('id', 1);
        }

        // Test 1x1 JPEG
        const testJpeg = new Uint8Array([
          0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01, 0x00, 0x48,
          0x00, 0x48, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43, 0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08,
          0x07, 0x07, 0x07, 0x09, 0x09, 0x08, 0x0a, 0x0c, 0x14, 0x0d, 0x0c, 0x0b, 0x0b, 0x0c, 0x19, 0x12,
          0x13, 0x0f, 0x14, 0x1d, 0x1a, 0x1f, 0x1e, 0x1d, 0x1a, 0x1c, 0x1c, 0x20, 0x24, 0x2e, 0x27, 0x20,
          0x22, 0x2c, 0x23, 0x1c, 0x1c, 0x28, 0x37, 0x29, 0x2c, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1f, 0x27,
          0x39, 0x3d, 0x38, 0x32, 0x3c, 0x2e, 0x33, 0x34, 0x32, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01,
          0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xc4, 0x00, 0x1f, 0x00, 0x00, 0x01, 0x05, 0x01, 0x01,
          0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04,
          0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f,
          0x00, 0xbf, 0x00, 0xff, 0xd9,
        ]);

        const uploadToken = await uploadBytesToGooglePhotos(accessToken, testJpeg, 'test_connection.jpg');
        await addMediaItemToAlbum(accessToken, albumId, uploadToken, 'M.A.T. Photobooth Connection Test');

        return jsonResponse(
          {
            ok: true,
            data: {
              success: true,
              message: `Successfully uploaded test photo to Google Photos (${albumTitle || 'Shared Album'})!`,
            },
          },
          200,
          {},
          correlationId,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Test upload failed';
        return jsonResponse(
          { ok: true, data: { success: false, message: `Upload test failed: ${msg}` } },
          200,
          {},
          correlationId,
        );
      }
    }

    if (action === 'sync-now') {
      const result = await processGooglePhotosSyncQueue(admin);
      return jsonResponse({ ok: true, data: result }, 200, {}, correlationId);
    }

    if (action === 'disconnect') {
      await admin
        .from('google_photos_config')
        .update({
          connected_email: null,
          album_id: null,
          album_title: null,
          album_share_url: null,
          refresh_token_encrypted: null,
          enabled: false,
          updated_at: new Date().toISOString(),
        })
        .eq('id', 1);

      return jsonResponse({ ok: true, data: {} }, 200, {}, correlationId);
    }

    return jsonResponse({ error: 'Unknown action' }, 400, {}, correlationId);
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}

if (import.meta.main) {
  Deno.serve(handler);
}
