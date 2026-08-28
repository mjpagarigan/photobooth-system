import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from 'npm:@aws-sdk/client-s3@^3.750.0';
import { getSignedUrl } from 'npm:@aws-sdk/s3-request-presigner@^3.750.0';
import { SIGNED_DOWNLOAD_VALID_FOR_SECONDS } from './constants.ts';
import { r2AccessKeyId, r2AccountId, r2BucketName, r2SecretAccessKey } from './env.ts';
import { ApiError } from './errors.ts';

export function createR2Client(): S3Client {
  return new S3Client({
    region: 'auto',
    endpoint: `https://${r2AccountId()}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: r2AccessKeyId(),
      secretAccessKey: r2SecretAccessKey(),
    },
  });
}

export async function createR2PresignedPutUrl(
  client: S3Client,
  key: string,
  contentType: string,
  expiresInSeconds: number,
  options: { ifNoneMatch?: '*' } = {},
  signer: R2PutUrlSigner = (signingClient, command, signingOptions) =>
    getSignedUrl(signingClient, command, signingOptions),
): Promise<string> {
  try {
    const command = new PutObjectCommand({
      Bucket: r2BucketName(),
      Key: key,
      ContentType: contentType,
      IfNoneMatch: options.ifNoneMatch,
    });
    return await signer(client, command, { expiresIn: expiresInSeconds });
  } catch {
    throw new ApiError(
      503,
      'unavailable',
      'Upload authorization is temporarily unavailable.',
      true,
    );
  }
}

export type R2PutUrlSigner = (
  client: S3Client,
  command: PutObjectCommand,
  options: { expiresIn: number },
) => Promise<string>;

export type R2DownloadDisposition = 'inline' | 'attachment';

const CONTROLLED_DOWNLOAD_FILENAME = 'mat-photobooth-keepsake.jpg';

export type R2GetUrlSigner = (
  client: S3Client,
  command: GetObjectCommand,
  options: { expiresIn: number },
) => Promise<string>;

export async function createR2PresignedGetUrl(
  client: S3Client,
  key: string,
  disposition: R2DownloadDisposition,
  expiresInSeconds: number,
  signer: R2GetUrlSigner = (signingClient, command, options) =>
    getSignedUrl(signingClient, command, options),
): Promise<string> {
  if (
    !Number.isSafeInteger(expiresInSeconds) ||
    expiresInSeconds < 1 ||
    expiresInSeconds > SIGNED_DOWNLOAD_VALID_FOR_SECONDS
  ) {
    throw new ApiError(500, 'internal_error', 'Download authorization is invalid.', true);
  }
  try {
    const command = new GetObjectCommand({
      Bucket: r2BucketName(),
      Key: key,
      ResponseContentType: 'image/jpeg',
      ResponseContentDisposition: `${disposition}; filename="${CONTROLLED_DOWNLOAD_FILENAME}"`,
      ResponseCacheControl: 'private, no-store, max-age=0',
    });
    return await signer(client, command, { expiresIn: expiresInSeconds });
  } catch {
    throw new ApiError(
      503,
      'unavailable',
      'Download authorization is temporarily unavailable.',
      true,
    );
  }
}

export async function checkR2ObjectExists(
  client: S3Client,
  key: string,
  signer: R2HeadUrlSigner = (signingClient, command, options) =>
    getSignedUrl(signingClient, command, options),
  request: R2HeadRequest = fetch,
): Promise<{ exists: boolean; byteSize: number | null }> {
  try {
    const command = new HeadObjectCommand({
      Bucket: r2BucketName(),
      Key: key,
    });
    const signedUrl = await signer(client, command, { expiresIn: 30 });
    const response = await request(signedUrl, {
      method: 'HEAD',
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status === 404) return { exists: false, byteSize: null };
    if (!response.ok) {
      throw new ApiError(
        503,
        'unavailable',
        'Storage verification is temporarily unavailable.',
        true,
      );
    }
    const contentLength = response.headers.get('content-length');
    const parsedContentLength = contentLength === null ? Number.NaN : Number(contentLength);
    return {
      exists: true,
      byteSize: Number.isSafeInteger(parsedContentLength) && parsedContentLength >= 0
        ? parsedContentLength
        : null,
    };
  } catch {
    throw new ApiError(
      503,
      'unavailable',
      'Storage verification is temporarily unavailable.',
      true,
    );
  }
}

export type R2HeadUrlSigner = (
  client: S3Client,
  command: HeadObjectCommand,
  options: { expiresIn: number },
) => Promise<string>;

export type R2HeadRequest = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export async function getR2ObjectBytes(
  client: S3Client,
  key: string,
): Promise<Uint8Array | null> {
  try {
    const command = new GetObjectCommand({
      Bucket: r2BucketName(),
      Key: key,
    });
    const response = await client.send(command);
    if (!response.Body) return null;
    return await response.Body.transformToByteArray();
  } catch (error: unknown) {
    const err = error as { name?: string; $metadata?: { httpStatusCode?: number } };
    if (err?.name === 'NoSuchKey' || err?.$metadata?.httpStatusCode === 404) {
      return null;
    }
    throw new ApiError(
      503,
      'unavailable',
      'Photo delivery is temporarily unavailable.',
      true,
    );
  }
}

export async function deleteR2Objects(
  client: S3Client,
  keys: string[],
): Promise<void> {
  if (keys.length === 0) return;
  try {
    const command = new DeleteObjectsCommand({
      Bucket: r2BucketName(),
      Delete: {
        Objects: keys.map((key) => ({ Key: key })),
        Quiet: true,
      },
    });
    await client.send(command);
  } catch {
    throw new ApiError(
      503,
      'unavailable',
      'Storage cleanup is temporarily unavailable.',
      true,
    );
  }
}
