export const MAX_EDGE_PIXELS = 12000;
export const PUBLIC_TOKEN_BYTES = 32;
export const PUBLIC_TOKEN_LENGTH = 43;
export const SIGNED_UPLOAD_VALID_FOR_SECONDS = 7200 as const;
export const SIGNED_DOWNLOAD_VALID_FOR_SECONDS = 300 as const;
export const PENDING_SESSION_RETENTION_HOURS = 24;
export const JSON_BODY_LIMIT_BYTES = 16 * 1024;
export const CLEANUP_BATCH_SIZE = 50;
export const CLEANUP_MAX_BATCHES = 4;

export const PUBLIC_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
export const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/;
export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
