import sharp, { type Metadata } from 'sharp';

import { AppError } from '../errors.js';

const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_SOURCE_BYTES = 50 * 1024 * 1024;
const MAX_FRAME_BYTES = 5 * 1024 * 1024;
const MAX_SOURCE_PIXELS = 80_000_000;
const MAX_FRAME_PIXELS = 25_000_000;
const MAX_EDGE = 12_000;

export type ValidatedImageDimensions = { width: number; height: number };
export type NormalizedFrame = ValidatedImageDimensions & { bytes: Buffer };

export async function validateSourceJpeg(bytes: Uint8Array): Promise<ValidatedImageDimensions> {
  validateSignature(bytes, JPEG_MAGIC, MAX_SOURCE_BYTES, 'JPEG');
  const image = sharp(bytes, {
    failOn: 'warning',
    limitInputPixels: MAX_SOURCE_PIXELS,
  });
  const metadata = await image.metadata();
  validateDecodedMetadata(metadata, MAX_SOURCE_PIXELS, 'photo');
  if (metadata.format !== 'jpeg') {
    throw new AppError('capture_format', 'The camera returned an invalid JPEG.');
  }
  await image.clone().rotate().stats();
  return { width: metadata.width, height: metadata.height };
}

export async function createThumbnailJpeg(
  bytes: Uint8Array,
  maxEdge = 360,
): Promise<{ bytes: Buffer; width: number; height: number }> {
  validateSignature(bytes, JPEG_MAGIC, MAX_SOURCE_BYTES, 'JPEG');
  const image = sharp(bytes, { failOn: 'warning', limitInputPixels: MAX_SOURCE_PIXELS });
  const metadata = await image.metadata();
  validateDecodedMetadata(metadata, MAX_SOURCE_PIXELS, 'photo');
  const { data, info } = await image
    .rotate()
    .resize(maxEdge, maxEdge, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 80, mozjpeg: false })
    .toBuffer({ resolveWithObject: true });
  return { bytes: data, width: info.width, height: info.height };
}

export function isSafeSourceByteLength(byteLength: number): boolean {
  return Number.isSafeInteger(byteLength) && byteLength > 0 && byteLength <= MAX_SOURCE_BYTES;
}

export function isSafeSourceGeometry(
  width: number,
  height: number,
  pages: number,
  channels: number,
): boolean {
  return (
    Number.isSafeInteger(width) &&
    Number.isSafeInteger(height) &&
    width > 0 &&
    height > 0 &&
    width <= MAX_EDGE &&
    height <= MAX_EDGE &&
    width * height <= MAX_SOURCE_PIXELS &&
    pages === 1 &&
    channels >= 1 &&
    channels <= 4
  );
}

export async function normalizeFramePng(bytes: Uint8Array): Promise<NormalizedFrame> {
  validateSignature(bytes, PNG_MAGIC, MAX_FRAME_BYTES, 'PNG');
  const image = sharp(bytes, { failOn: 'warning', limitInputPixels: MAX_FRAME_PIXELS });
  const metadata = await image.metadata();
  validateDecodedMetadata(metadata, MAX_FRAME_PIXELS, 'frame');
  if (metadata.format !== 'png' || !metadata.hasAlpha) {
    throw new AppError('frame_invalid', 'Choose a transparent PNG within the size limit.');
  }
  const stats = await sharp(bytes, { limitInputPixels: MAX_FRAME_PIXELS }).stats();
  if ((stats.channels.at(-1)?.min ?? 255) >= 255) {
    throw new AppError('frame_opaque', 'The frame PNG must contain transparent pixels.');
  }
  const normalized = await sharp(bytes, { limitInputPixels: MAX_FRAME_PIXELS })
    .rotate()
    .ensureAlpha()
    .png({ compressionLevel: 9, adaptiveFiltering: false })
    .toBuffer();
  const corrected = await sharp(normalized, { limitInputPixels: MAX_FRAME_PIXELS }).metadata();
  validateDecodedMetadata(corrected, MAX_FRAME_PIXELS, 'frame');
  return { bytes: normalized, width: corrected.width, height: corrected.height };
}

function validateSignature(
  bytes: Uint8Array,
  magic: Buffer,
  maximumBytes: number,
  label: string,
): void {
  if (
    bytes.byteLength === 0 ||
    bytes.byteLength > maximumBytes ||
    !Buffer.from(bytes.subarray(0, magic.length)).equals(magic)
  ) {
    throw new AppError('image_signature', `${label} image signature or size is invalid.`);
  }
}

function validateDecodedMetadata(
  metadata: Metadata,
  maximumPixels: number,
  label: string,
): asserts metadata is Metadata & { width: number; height: number } {
  const width = metadata.width;
  const height = metadata.height;
  const pages = metadata.pages ?? 1;
  const channels = metadata.channels;
  const safe =
    maximumPixels === MAX_SOURCE_PIXELS
      ? isSafeSourceGeometry(width, height, pages, channels)
      : width > 0 &&
        height > 0 &&
        width <= MAX_EDGE &&
        height <= MAX_EDGE &&
        width * height <= maximumPixels &&
        pages === 1 &&
        channels >= 1 &&
        channels <= 4;
  if (!safe) {
    throw new AppError('image_dimensions', `The ${label} dimensions are outside the safe limit.`);
  }
}
