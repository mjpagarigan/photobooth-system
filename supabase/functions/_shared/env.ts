import { ApiError } from './errors.ts';

function required(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) {
    throw new ApiError(500, 'internal_error', 'The service is not configured.', true);
  }
  return value;
}

export function supabaseUrl(): string {
  const value = required('SUPABASE_URL');
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new ApiError(500, 'internal_error', 'The service is not configured.', true);
  }

  const local = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost' ||
    parsed.hostname === 'kong';
  if ((parsed.protocol !== 'https:' && !local) || parsed.username || parsed.password) {
    throw new ApiError(500, 'internal_error', 'The service is not configured.', true);
  }

  return parsed.origin;
}

export function supabaseServerKey(): string {
  const explicit = Deno.env.get('SUPABASE_SECRET_KEY')?.trim();
  if (explicit) return explicit;

  const configuredKeys = Deno.env.get('SUPABASE_SECRET_KEYS')?.trim();
  if (configuredKeys) {
    try {
      const parsed = JSON.parse(configuredKeys) as unknown;
      if (parsed && typeof parsed === 'object') {
        const defaultKey = (parsed as Record<string, unknown>)['default'];
        if (typeof defaultKey === 'string' && defaultKey.trim()) return defaultKey.trim();
      }
    } catch {
      throw new ApiError(500, 'internal_error', 'The service is not configured.', true);
    }
  }

  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim();
  if (legacy) return legacy;
  return required('SUPABASE_SECRET_KEY');
}

export function publicPageOrigin(): string {
  const value = required('PUBLIC_PAGE_ORIGIN');
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new ApiError(500, 'internal_error', 'The public page origin is invalid.', true);
  }

  const local = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost';
  if (
    (parsed.protocol !== 'https:' && !(local && parsed.protocol === 'http:')) ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash
  ) {
    throw new ApiError(500, 'internal_error', 'The public page origin is invalid.', true);
  }

  return parsed.origin;
}

export function cleanupSecret(): string {
  const value = required('CLEANUP_SECRET');
  if (value.length < 32 || value.length > 512) {
    throw new ApiError(500, 'internal_error', 'The cleanup service is not configured.', true);
  }
  return value;
}

function decodeHex(value: string): Uint8Array | null {
  if (!/^[a-f0-9]+$/iu.test(value) || value.length % 2 !== 0) return null;
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < value.length; index += 2) {
    bytes[index / 2] = Number.parseInt(value.slice(index, index + 2), 16);
  }
  return bytes;
}

function decodeBase64(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/u.test(value)) return null;
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/').replace(/=+$/u, '');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  try {
    const binary = atob(padded);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

export function parsePublicTokenDerivationKey(encoded: string): Uint8Array {
  const decoded = decodeHex(encoded) ?? decodeBase64(encoded);
  if (!decoded || decoded.byteLength < 32) {
    throw new ApiError(500, 'internal_error', 'The token service is not configured.', true);
  }
  return decoded;
}

export function publicTokenDerivationKey(): Uint8Array {
  return parsePublicTokenDerivationKey(required('PUBLIC_TOKEN_DERIVATION_KEY'));
}

export function photoBucket(): string {
  const value = Deno.env.get('PHOTO_BUCKET')?.trim() || 'photos';
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/u.test(value)) {
    throw new ApiError(500, 'internal_error', 'The photo bucket is not configured.', true);
  }
  return value;
}

export type R2Configuration = {
  accountId: string | undefined;
  accessKeyId: string | undefined;
  secretAccessKey: string | undefined;
  bucketName: string | undefined;
};

export function hasCompleteR2Configuration(configuration: R2Configuration): boolean {
  const configuredValues = Object.values(configuration).filter((value) => Boolean(value?.trim()));
  if (configuredValues.length === 0) return false;
  if (configuredValues.length !== 4) {
    throw new ApiError(500, 'internal_error', 'The photo storage service is not configured.', true);
  }
  return true;
}

export function isR2Configured(): boolean {
  return hasCompleteR2Configuration({
    accountId: Deno.env.get('R2_ACCOUNT_ID'),
    accessKeyId: Deno.env.get('R2_ACCESS_KEY_ID'),
    secretAccessKey: Deno.env.get('R2_SECRET_ACCESS_KEY'),
    bucketName: Deno.env.get('R2_BUCKET_NAME'),
  });
}

export function r2AccountId(): string {
  return required('R2_ACCOUNT_ID');
}

export function r2AccessKeyId(): string {
  return required('R2_ACCESS_KEY_ID');
}

export function r2SecretAccessKey(): string {
  return required('R2_SECRET_ACCESS_KEY');
}

export function r2BucketName(): string {
  return required('R2_BUCKET_NAME');
}
