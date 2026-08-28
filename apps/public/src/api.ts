import { PHOTO_API_BASE_URL } from './config';

export type ResolvedPhoto = {
  status: 'ready';
  expiresAt: string;
  googleFormsUrl: string | null;
};

export class PhotoApiError extends Error {
  readonly retryable: boolean;

  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = 'PhotoApiError';
    this.retryable = retryable;
  }
}

function allowedGoogleFormsUrl(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== 'string' || value.length > 2048) return undefined;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const allowed =
      host === 'forms.gle' ||
      host === 'forms.google.com' ||
      (host === 'docs.google.com' && url.pathname.startsWith('/forms/'));
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      (url.port && url.port !== '443') ||
      !allowed
    ) {
      return undefined;
    }
    return url.toString();
  } catch {
    return undefined;
  }
}

async function post(route: 'resolve' | 'image' | 'download', token: string, signal?: AbortSignal) {
  const response = await fetch(`${PHOTO_API_BASE_URL}/${route}`, {
    method: 'POST',
    mode: 'cors',
    credentials: 'omit',
    cache: 'no-store',
    redirect: 'follow',
    referrerPolicy: 'no-referrer',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) {
    let retryable = response.status >= 500 || response.status === 429;
    try {
      const payload = (await response.json()) as { error?: { retryable?: unknown } };
      if (typeof payload.error?.retryable === 'boolean') retryable = payload.error.retryable;
    } catch {
      // Error response bodies are intentionally not surfaced or logged.
    }
    throw new PhotoApiError(
      response.status === 404
        ? 'This photo is unavailable or has expired.'
        : 'We could not load this photo right now.',
      retryable,
    );
  }
  return response;
}

export async function resolvePhoto(token: string, signal?: AbortSignal): Promise<ResolvedPhoto> {
  const response = await post('resolve', token, signal);
  const payload = (await response.json()) as Record<string, unknown>;
  const googleFormsUrl = allowedGoogleFormsUrl(payload.googleFormsUrl);
  if (
    payload.status !== 'ready' ||
    typeof payload.expiresAt !== 'string' ||
    !Number.isFinite(Date.parse(payload.expiresAt)) ||
    googleFormsUrl === undefined
  ) {
    throw new PhotoApiError('We could not load this photo right now.', true);
  }
  return { status: 'ready', expiresAt: payload.expiresAt, googleFormsUrl };
}

async function fetchPhotoBlob(
  route: 'image' | 'download',
  token: string,
  signal?: AbortSignal,
): Promise<Blob> {
  const response = await post(route, token, signal);
  let responseOrigin: string;
  try {
    responseOrigin = new URL(response.url).origin;
  } catch {
    throw new PhotoApiError('We could not load this photo right now.', true);
  }
  if (response.redirected || responseOrigin !== new URL(PHOTO_API_BASE_URL).origin) {
    throw new PhotoApiError('We could not load this photo right now.', true);
  }
  const type = response.headers.get('content-type')?.split(';', 1)[0]?.toLowerCase();
  const contentLength = response.headers.get('content-length');
  const declaredLength = contentLength === null ? null : Number(contentLength);
  if (
    type !== 'image/jpeg' ||
    (declaredLength !== null && (!Number.isSafeInteger(declaredLength) || declaredLength < 1))
  ) {
    throw new PhotoApiError('We could not load this photo right now.', true);
  }
  const blob = await response.blob();
  if (blob.size < 1) {
    throw new PhotoApiError('We could not load this photo right now.', true);
  }
  const [prefix, suffix] = await Promise.all([
    blob.slice(0, 3).arrayBuffer(),
    blob.slice(Math.max(0, blob.size - 2)).arrayBuffer(),
  ]);
  const leadingBytes = new Uint8Array(prefix);
  const trailingBytes = new Uint8Array(suffix);
  if (
    leadingBytes.length !== 3 ||
    leadingBytes[0] !== 0xff ||
    leadingBytes[1] !== 0xd8 ||
    leadingBytes[2] !== 0xff ||
    trailingBytes.length !== 2 ||
    trailingBytes[0] !== 0xff ||
    trailingBytes[1] !== 0xd9
  ) {
    throw new PhotoApiError('We could not load this photo right now.', true);
  }
  return blob;
}

export function fetchPhotoImage(token: string, signal?: AbortSignal): Promise<Blob> {
  return fetchPhotoBlob('image', token, signal);
}

export function fetchPhotoDownload(token: string, signal?: AbortSignal): Promise<Blob> {
  return fetchPhotoBlob('download', token, signal);
}
