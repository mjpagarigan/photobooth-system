import {
  AuthorizePhotoRepairResponseSchema,
  BoothAuthSessionSchema,
  ConfirmUploadResponseSchema,
  CreateUploadResponseSchema,
  GooglePhotosStatusSchema,
  ResumeUploadResponseSchema,
  type ConfirmUploadRequest,
  type ConfirmUploadResponse,
  type AuthorizePhotoRepairRequest,
  type AuthorizePhotoRepairResponse,
  type ConfirmPhotoRepairRequest,
  type CreateUploadRequest,
  type CreateUploadResponse,
  type ResumeUploadRequest,
  type ResumeUploadResponse,
  type PhotoAvailability,
  type GooglePhotosConfig,
  type GooglePhotosStatus,
} from '@grace-booth/shared';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import type { CloudSessionStore } from '../auth/cloud-session-store.js';
import { AppError } from '../errors.js';

const REQUEST_TIMEOUT_MS = 30_000;
const PHOTO_AVAILABILITY_TIMEOUT_MS = 5_000;

export type DeliveryClient = {
  isConfigured(): boolean;
  reconfigure(options: SupabaseDeliveryOptions): void;
  ensureAuthenticated(): Promise<void>;
  connect(email: string, password: string): Promise<void>;
  createUpload(request: CreateUploadRequest): Promise<CreateUploadResponse>;
  resumeUpload(request: ResumeUploadRequest): Promise<ResumeUploadResponse>;
  uploadSigned(
    path: string,
    token: string,
    bytes: Uint8Array,
    uploadUrl?: string,
    requiredHeaders?: Readonly<Record<string, string>>,
  ): Promise<void>;
  confirmUpload(request: ConfirmUploadRequest): Promise<ConfirmUploadResponse>;
  checkPhotoAvailability(publicToken: string, publicPageOrigin: string): Promise<PhotoAvailability>;
  authorizePhotoRepair(
    request: AuthorizePhotoRepairRequest,
  ): Promise<AuthorizePhotoRepairResponse>;
  confirmPhotoRepair(request: ConfirmPhotoRepairRequest): Promise<ConfirmUploadResponse>;
  getGooglePhotosStatus?(): Promise<GooglePhotosStatus>;
  saveGooglePhotosConfig?(config: GooglePhotosConfig): Promise<void>;
  createGooglePhotosAlbum?(title: string): Promise<{ albumId: string; albumTitle: string; shareUrl: string }>;
  listGooglePhotosAlbums?(): Promise<Array<{ id: string; title: string; shareUrl?: string }>>;
  resolveGooglePhotosAlbum?(shareUrl: string): Promise<{ albumId: string; albumTitle: string; shareUrl: string }>;
  syncGooglePhotosNow?(): Promise<{ processed: number; succeeded: number; failed: number }>;
  testGooglePhotosUpload?(): Promise<{ success: boolean; message: string }>;
  disconnectGooglePhotos?(): Promise<void>;
  health(): Promise<{ healthy: boolean; code: string | null; message: string }>;
};

export type DeliveryFailureKind = 'auth' | 'transient' | 'signed_capability_expired' | 'permanent';

export class DeliveryFailure extends AppError {
  constructor(
    readonly kind: DeliveryFailureKind,
    code: string,
    safeMessage: string,
    options?: ErrorOptions,
  ) {
    super(code, safeMessage, kind === 'transient', options);
    this.name = 'DeliveryFailure';
  }
}

export type SupabaseDeliveryOptions = {
  url: string | null;
  publishableKey: string | null;
};

export class SupabaseDeliveryClient implements DeliveryClient {
  private options: SupabaseDeliveryOptions;
  private client: SupabaseClient | null = null;

  constructor(
    options: SupabaseDeliveryOptions,
    private readonly sessions: CloudSessionStore,
  ) {
    this.options = { ...options };
    this.reconfigure(options);
  }

  reconfigure(options: SupabaseDeliveryOptions): void {
    this.options = { ...options };
    this.client =
      this.options.url && this.options.publishableKey
        ? createClient(this.options.url, this.options.publishableKey, {
            auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
            global: { fetch: fetchWithTimeout },
          })
        : null;
  }

  isConfigured(): boolean {
    return this.client !== null;
  }

  async ensureAuthenticated(): Promise<void> {
    await this.requireAccessToken();
  }

  async connect(email: string, password: string): Promise<void> {
    const client = this.requireClient();
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) {
      throw new AppError(
        'cloud_login_failed',
        error.message
          ? `Cloud connection failed: ${error.message}`
          : 'Cloud connection failed. Check the booth account.',
        false,
        {
          cause: error,
        },
      );
    }
    const expiresAt =
      data.session.expires_at ?? Math.floor(Date.now() / 1_000) + data.session.expires_in;
    this.sessions.save(
      BoothAuthSessionSchema.parse({
        accessToken: data.session.access_token,
        refreshToken: data.session.refresh_token,
        expiresAt,
        userId: data.user.id,
      }),
    );
  }

  async createUpload(request: CreateUploadRequest): Promise<CreateUploadResponse> {
    try {
      return CreateUploadResponseSchema.parse(await this.invokeFunction('create-upload', request));
    } catch (error) {
      if (
        request.capturedAt === undefined ||
        !(error instanceof DeliveryFailure) ||
        error.kind !== 'permanent' ||
        error.code !== 'invalid_request'
      ) {
        throw error;
      }

      // Keep kiosk and Edge Function rollouts independently deployable. Older strict function
      // schemas do not know about capturedAt, so retry once with the legacy request shape.
      const legacyRequest: CreateUploadRequest = { ...request };
      delete legacyRequest.capturedAt;
      try {
        return CreateUploadResponseSchema.parse(
          await this.invokeFunction('create-upload', legacyRequest),
        );
      } catch (legacyError) {
        if (
          legacyError instanceof DeliveryFailure &&
          legacyError.kind === 'permanent' &&
          legacyError.code === 'invalid_request'
        ) {
          throw new DeliveryFailure(
            'permanent',
            'cloud_schema_incompatible',
            'The cloud photo service must be updated before this strip can upload.',
            { cause: legacyError },
          );
        }
        throw legacyError;
      }
    }
  }

  async resumeUpload(request: ResumeUploadRequest): Promise<ResumeUploadResponse> {
    return ResumeUploadResponseSchema.parse(await this.invokeFunction('create-upload', request));
  }

  async uploadSigned(
    path: string,
    token: string,
    bytes: Uint8Array,
    uploadUrl?: string,
    requiredHeaders?: Readonly<Record<string, string>>,
  ): Promise<void> {
    if (uploadUrl) {
      try {
        const response = await fetchWithTimeout(uploadUrl, {
          method: 'PUT',
          headers: {
            'content-type': 'image/jpeg',
            ...requiredHeaders,
          },
          body: bytes,
        });
        if (!response.ok) {
          throwSignedUploadFailure({
            status: response.status,
            message: `Cloudflare R2 upload returned HTTP ${response.status}`,
          });
        }
        return;
      } catch (error) {
        if (error instanceof DeliveryFailure) throw error;
        throwSignedUploadFailure(error);
      }
    }

    const client = this.requireClient();
    try {
      const { error } = await client.storage
        .from('photos')
        .uploadToSignedUrl(path, token, bytes, { contentType: 'image/jpeg' });
      if (error) throwSignedUploadFailure(error);
    } catch (error) {
      if (error instanceof DeliveryFailure) throw error;
      throwSignedUploadFailure(error);
    }
  }

  async confirmUpload(request: ConfirmUploadRequest): Promise<ConfirmUploadResponse> {
    return ConfirmUploadResponseSchema.parse(await this.invokeFunction('confirm-upload', request));
  }

  async checkPhotoAvailability(
    publicToken: string,
    publicPageOrigin: string,
  ): Promise<PhotoAvailability> {
    const url = this.options.url;
    const publishableKey = this.options.publishableKey;
    if (!url || !publishableKey) return 'verification-failed';
    let origin: string;
    try {
      const parsed = new URL(publicPageOrigin);
      if (parsed.protocol !== 'https:' || parsed.origin !== publicPageOrigin) {
        return 'verification-failed';
      }
      origin = parsed.origin;
    } catch {
      return 'verification-failed';
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PHOTO_AVAILABILITY_TIMEOUT_MS);
    try {
      const response = await fetch(`${url}/functions/v1/photo/resolve`, {
        method: 'POST',
        headers: {
          Origin: origin,
          apikey: publishableKey,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ token: publicToken }),
        signal: controller.signal,
      });
      if (response.status === 404) return 'unavailable';
      if (!response.ok) return 'verification-failed';
      const payload = (await response.json().catch(() => null)) as { status?: unknown } | null;
      return payload?.status === 'ready' ? 'available' : 'verification-failed';
    } catch {
      return 'verification-failed';
    } finally {
      clearTimeout(timeout);
    }
  }

  async authorizePhotoRepair(
    request: AuthorizePhotoRepairRequest,
  ): Promise<AuthorizePhotoRepairResponse> {
    return AuthorizePhotoRepairResponseSchema.parse(
      await this.invokeFunction('repair-photo', request),
    );
  }

  async confirmPhotoRepair(request: ConfirmPhotoRepairRequest): Promise<ConfirmUploadResponse> {
    return ConfirmUploadResponseSchema.parse(await this.invokeFunction('repair-photo', request));
  }

  async getGooglePhotosStatus(): Promise<GooglePhotosStatus> {
    const res = await this.invokeFunction('google-photos-auth', { action: 'get-status' });
    return GooglePhotosStatusSchema.parse(res);
  }

  async saveGooglePhotosConfig(config: GooglePhotosConfig): Promise<void> {
    await this.invokeFunction('google-photos-auth', { action: 'save-config', config });
  }

  async createGooglePhotosAlbum(
    title: string,
  ): Promise<{ albumId: string; albumTitle: string; shareUrl: string }> {
    const res = (await this.invokeFunction('google-photos-auth', {
      action: 'create-album',
      title,
    })) as {
      ok: boolean;
      data: { albumId: string; albumTitle: string; shareUrl: string };
    };
    return res.data;
  }

  async listGooglePhotosAlbums(): Promise<Array<{ id: string; title: string; shareUrl?: string }>> {
    const res = (await this.invokeFunction('google-photos-auth', {
      action: 'list-albums',
    })) as {
      ok: boolean;
      data: { albums: Array<{ id: string; title: string; shareUrl?: string }> };
    };
    return res.data?.albums || [];
  }

  async resolveGooglePhotosAlbum(
    shareUrl: string,
  ): Promise<{ albumId: string; albumTitle: string; shareUrl: string }> {
    const res = (await this.invokeFunction('google-photos-auth', {
      action: 'resolve-album',
      shareUrl,
    })) as {
      ok: boolean;
      data: { albumId: string; albumTitle: string; shareUrl: string };
    };
    return res.data;
  }

  async syncGooglePhotosNow(): Promise<{ processed: number; succeeded: number; failed: number }> {
    const res = (await this.invokeFunction('google-photos-auth', {
      action: 'sync-now',
    })) as {
      ok: boolean;
      data: { processed: number; succeeded: number; failed: number };
    };
    return res.data;
  }

  async testGooglePhotosUpload(): Promise<{ success: boolean; message: string }> {
    const res = (await this.invokeFunction('google-photos-auth', {
      action: 'test-upload',
    })) as {
      ok: boolean;
      data: { success: boolean; message: string };
    };
    return res.data;
  }

  async disconnectGooglePhotos(): Promise<void> {
    await this.invokeFunction('google-photos-auth', { action: 'disconnect' });
  }

  async health(): Promise<{ healthy: boolean; code: string | null; message: string }> {
    if (!this.client)
      return { healthy: false, code: 'cloud_unconfigured', message: 'Cloud is not configured.' };
    try {
      await this.requireAccessToken();
      return { healthy: true, code: null, message: 'Cloud authentication is ready.' };
    } catch {
      return {
        healthy: false,
        code: 'cloud_auth_required',
        message: 'Connect the dedicated booth cloud account.',
      };
    }
  }

  private async invokeFunction(name: string, body: unknown): Promise<unknown> {
    const accessToken = await this.requireAccessToken();
    const url = this.options.url;
    const publishableKey = this.options.publishableKey;
    if (!url || !publishableKey) {
      throw new DeliveryFailure('auth', 'cloud_unconfigured', 'Cloud delivery is not configured.');
    }
    let response: Response;
    try {
      response = await fetchWithTimeout(`${url}/functions/v1/${name}`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${accessToken}`,
          apikey: publishableKey,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      });
    } catch (error) {
      throw new DeliveryFailure(
        'transient',
        'cloud_network_error',
        'The photo service is temporarily unreachable.',
        { cause: error },
      );
    }
    const responseBody = await response.json().catch(() => null);
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new DeliveryFailure(
          'auth',
          'cloud_auth_required',
          'Reconnect the dedicated booth cloud account.',
        );
      }
      const transient = response.status === 429 || response.status >= 500;
      const serverError = functionErrorFromResponse(responseBody);
      const serverCode =
        serverError.code ?? (transient ? 'cloud_unavailable' : 'cloud_request_rejected');

      throw new DeliveryFailure(
        transient ? 'transient' : 'permanent',
        serverCode,
        serverError.message ??
          (transient
            ? 'The photo service is temporarily unavailable.'
            : 'The photo service rejected the request.'),
      );
    }
    return responseBody;
  }

  private requireClient(): SupabaseClient {
    if (!this.client) {
      throw new DeliveryFailure(
        'auth',
        'cloud_unconfigured',
        'Cloud delivery is not configured. Set GRACE_BOOTH_SUPABASE_URL and key in your environment.',
      );
    }
    return this.client;
  }

  private async requireAccessToken(): Promise<string> {
    const client = this.requireClient();
    const stored = this.sessions.load();
    if (!stored) {
      throw new DeliveryFailure(
        'auth',
        'cloud_auth_required',
        'Connect the dedicated booth cloud account.',
      );
    }
    if (stored.expiresAt > Math.floor(Date.now() / 1_000) + 60) return stored.accessToken;

    if (!stored.refreshToken) {
      return stored.accessToken;
    }

    const { data, error } = await client.auth.refreshSession({
      refresh_token: stored.refreshToken,
    });
    if (error || !data.session || !data.user) {
      throw new DeliveryFailure(
        'auth',
        'cloud_auth_expired',
        'Reconnect the dedicated booth cloud account.',
        { cause: error ?? undefined },
      );
    }
    const expiresAt =
      data.session.expires_at ?? Math.floor(Date.now() / 1_000) + data.session.expires_in;
    const refreshed = BoothAuthSessionSchema.parse({
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token || stored.refreshToken,
      expiresAt,
      userId: data.user.id,
    });
    this.sessions.save(refreshed);
    return refreshed.accessToken;
  }
}

function functionErrorFromResponse(body: unknown): { code: string | null; message: string | null } {
  if (!body || typeof body !== 'object') return { code: null, message: null };
  const response = body as Record<string, unknown>;
  if (typeof response.error === 'string') {
    return { code: null, message: response.error };
  }
  const candidate =
    response.error && typeof response.error === 'object'
      ? (response.error as Record<string, unknown>)
      : response;
  return {
    code: typeof candidate.code === 'string' ? candidate.code : null,
    message:
      typeof candidate.message === 'string'
        ? candidate.message
        : typeof candidate.error === 'string'
          ? candidate.error
          : null,
  };
}

export function classifySignedUploadFailure(error: unknown): Exclude<DeliveryFailureKind, 'auth'> {
  const status = statusFromUnknown(error);
  const code = codeFromUnknown(error);
  if (
    status === 401 ||
    status === 403 ||
    code === 'InvalidJWT' ||
    code === 'InvalidUploadSignature'
  ) {
    return 'signed_capability_expired';
  }
  if (status === null || status === 408 || status === 429 || status >= 500) {
    return 'transient';
  }
  return 'permanent';
}

function throwSignedUploadFailure(error: unknown): never {
  const kind = classifySignedUploadFailure(error);
  if (kind === 'signed_capability_expired') {
    throw new DeliveryFailure(
      kind,
      'signed_upload_expired',
      'The upload authorization expired and will be renewed.',
      { cause: error },
    );
  }
  throw new DeliveryFailure(
    kind,
    kind === 'transient' ? 'cloud_upload_unavailable' : 'cloud_upload_rejected',
    kind === 'transient'
      ? 'The secure photo upload is temporarily unavailable.'
      : 'The secure photo upload was rejected.',
    { cause: error },
  );
}

function statusFromUnknown(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null;
  const record = error as Record<string, unknown>;
  const candidate = record.statusCode ?? record.status;
  if (typeof candidate === 'number') return candidate;
  if (typeof candidate === 'string' && /^\d{3}$/.test(candidate)) return Number(candidate);
  return null;
}

function codeFromUnknown(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  const record = error as Record<string, unknown>;
  const candidate = record.code ?? record.error;
  return typeof candidate === 'string' ? candidate : null;
}

async function fetchWithTimeout(
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}
