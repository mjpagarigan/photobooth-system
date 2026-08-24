import { JSON_BODY_LIMIT_BYTES } from './constants.ts';
import { ApiError, normalizeError } from './errors.ts';

const encoder = new TextEncoder();

const BASE_SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'Cache-Control': 'no-store, max-age=0',
  Pragma: 'no-cache',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Resource-Policy': 'same-site',
};

export function requestId(): string {
  return crypto.randomUUID();
}

export function withBaseHeaders(initial: HeadersInit = {}, correlationId = requestId()): Headers {
  const headers = new Headers(BASE_SECURITY_HEADERS);
  const additions = new Headers(initial);
  additions.forEach((value, key) => headers.set(key, value));
  headers.set('X-Request-Id', correlationId);
  return headers;
}

export function jsonResponse(
  body: unknown,
  status = 200,
  initialHeaders: HeadersInit = {},
  correlationId?: string,
): Response {
  const headers = withBaseHeaders(
    {
      'Content-Type': 'application/json; charset=utf-8',
      ...Object.fromEntries(new Headers(initialHeaders)),
    },
    correlationId,
  );
  return new Response(JSON.stringify(body), { status, headers });
}

export function errorResponse(error: unknown, correlationId?: string): Response {
  const normalized = normalizeError(error);
  return jsonResponse(
    {
      error: {
        code: normalized.code,
        message: normalized.message,
        retryable: normalized.retryable,
      },
    },
    normalized.status,
    {},
    correlationId,
  );
}

export function assertPost(request: Request): void {
  if (request.method !== 'POST') {
    throw new ApiError(405, 'invalid_request', 'Only POST requests are accepted.');
  }
}

export async function readJson(request: Request, limit = JSON_BODY_LIMIT_BYTES): Promise<unknown> {
  const contentType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (contentType !== 'application/json') {
    throw new ApiError(415, 'invalid_request', 'Content-Type must be application/json.');
  }

  const declaredLength = request.headers.get('content-length');
  if (declaredLength !== null) {
    const byteLength = Number(declaredLength);
    if (!Number.isSafeInteger(byteLength) || byteLength < 0 || byteLength > limit) {
      throw new ApiError(413, 'invalid_request', 'The request body is too large.');
    }
  }

  const text = await request.text();
  if (encoder.encode(text).byteLength > limit) {
    throw new ApiError(413, 'invalid_request', 'The request body is too large.');
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ApiError(400, 'invalid_request', 'The request body must be valid JSON.');
  }
}

export function publicCorsHeaders(origin: string): HeadersInit {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
}

export function isAllowedOrigin(origin: string | null, allowedOrigin: string): boolean {
  return origin === allowedOrigin;
}

export function assertExactOrigin(request: Request, allowedOrigin: string): void {
  const origin = request.headers.get('origin');
  if (!isAllowedOrigin(origin, allowedOrigin)) {
    throw new ApiError(403, 'forbidden', 'This request origin is not allowed.');
  }
}

export function publicErrorResponse(
  error: unknown,
  allowedOrigin: string,
  correlationId?: string,
): Response {
  const normalized = normalizeError(error);
  const safeError = normalized.status === 404
    ? new ApiError(404, 'not_found', 'This photo is unavailable or has expired.')
    : normalized;
  return jsonResponse(
    {
      error: {
        code: safeError.code,
        message: safeError.message,
        retryable: safeError.retryable,
      },
    },
    safeError.status,
    publicCorsHeaders(allowedOrigin),
    correlationId,
  );
}
