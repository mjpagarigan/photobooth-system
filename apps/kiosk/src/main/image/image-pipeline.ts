import { performance } from 'node:perf_hooks';

import { FrameLayoutSchema, type FrameLayout } from '@grace-booth/shared';
import sharp, { type Metadata } from 'sharp';

import { AppError } from '../errors.js';
import type { CropFocus, CropStrategy } from './crop-strategy.js';
import { PRODUCTION_STRIP_EXPORT, PRODUCTION_STRIP_JPEG_OPTIONS } from './strip-export-config.js';

const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_SOURCE_BYTES = 50 * 1024 * 1024;
const MAX_FRAME_BYTES = 50 * 1024 * 1024;
const MAX_INPUT_PIXELS = 80_000_000;
const MAX_EDGE = 12_000;

export type ImagePipelineInput = {
  captures: readonly [Uint8Array, Uint8Array, Uint8Array] | readonly Uint8Array[];
  framePng: Uint8Array;
  slots: FrameLayout;
  frameAspectRatio?: number;
};

export type ImagePipelineResult = {
  bytes: Buffer;
  width: number;
  height: number;
  byteSize: number;
  timing: {
    validationMs: number;
    slotsMs: number;
    compositeMs: number;
    totalMs: number;
  };
};

export class ImagePipeline {
  constructor(private readonly cropStrategy: CropStrategy) {}

  async process(input: ImagePipelineInput): Promise<ImagePipelineResult> {
    const startedAt = performance.now();
    const slots = FrameLayoutSchema.parse(input.slots);
    if (input.captures.length !== slots.length) {
      throw new AppError('capture_count', `Exactly ${slots.length} photos are required.`);
    }
    for (const capture of input.captures) {
      validateSignatureAndSize(capture, JPEG_MAGIC, 'JPEG', MAX_SOURCE_BYTES);
    }
    validateSignatureAndSize(input.framePng, PNG_MAGIC, 'PNG', MAX_FRAME_BYTES);

    const captureMetadata = await Promise.all(
      input.captures.map((bytes) =>
        sharp(bytes, { failOn: 'warning', limitInputPixels: MAX_INPUT_PIXELS }).metadata(),
      ),
    );
    for (const metadata of captureMetadata) validateMetadata(metadata, 'photo');
    const frameMetadata = await sharp(input.framePng, {
      failOn: 'warning',
      limitInputPixels: MAX_INPUT_PIXELS,
    }).metadata();
    validateMetadata(frameMetadata, 'frame');
    if (frameMetadata.format !== 'png' || !frameMetadata.hasAlpha) {
      throw new AppError('frame_format', 'The frame must be a transparent PNG.');
    }
    const frameStats = await sharp(input.framePng, { limitInputPixels: MAX_INPUT_PIXELS }).stats();
    const alphaStats = frameStats.channels.at(-1);
    if (alphaStats?.min === undefined || alphaStats.min >= 255) {
      throw new AppError('frame_opaque', 'The frame PNG must contain transparent pixels.');
    }
    const correctedFrameSize = orientedSize(frameMetadata);
    const decodedAspect = correctedFrameSize.width / correctedFrameSize.height;
    if (
      input.frameAspectRatio !== undefined &&
      (!Number.isFinite(input.frameAspectRatio) ||
        Math.abs(input.frameAspectRatio - decodedAspect) > 0.000_001)
    ) {
      throw new AppError('frame_dimensions', 'The saved frame dimensions do not match the PNG.');
    }
    const validationComplete = performance.now();

    const canvas = correctedFrameSize;
    const focusPoints = await Promise.all(
      input.captures.map((capture) => this.cropStrategy.locateFace(capture)),
    );
    const renderedSlots = await Promise.all(
      [...slots].sort((left, right) => left.zIndex - right.zIndex).map(async (slot) => {
        const sourceIndex = slot.slotIndex - 1;
        const capture = input.captures[sourceIndex];
        const metadata = captureMetadata[sourceIndex];
        if (!capture || !metadata)
          throw new AppError('capture_count', `${slots.length} photos are required.`);
        const box = slotBox(slot, canvas.width, canvas.height);
        const corrected = orientedSize(metadata);
        let pipeline = sharp(capture, {
          failOn: 'warning',
          limitInputPixels: MAX_INPUT_PIXELS,
        }).rotate();
        if (slot.cropMode === 'crop-to-fill') {
          const focus = focusPoints[sourceIndex] ?? { x: 0.5, y: 0.5 };
          const region = cropRegion(
            corrected.width,
            corrected.height,
            box.width / box.height,
            focus,
          );
          pipeline = pipeline.extract(region).resize(box.width, box.height, { fit: 'fill' });
        } else {
          pipeline = pipeline.resize(box.width, box.height, {
            fit: 'contain',
            background: { r: 248, g: 247, b: 243, alpha: 1 },
          });
        }
        const rendered = await pipeline.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        return {
          input: rendered.data,
          raw: {
            width: rendered.info.width,
            height: rendered.info.height,
            channels: rendered.info.channels,
          },
          left: box.left,
          top: box.top,
        };
      }),
    );
    const slotsComplete = performance.now();

    const frameOverlay = await sharp(input.framePng, { limitInputPixels: MAX_INPUT_PIXELS })
      .rotate()
      .resize(canvas.width, canvas.height, { fit: 'fill' })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const bytes = await sharp({
      create: {
        width: canvas.width,
        height: canvas.height,
        channels: 3,
        background: { r: 248, g: 247, b: 243 },
      },
    })
      .composite([
        ...renderedSlots,
        {
          input: frameOverlay.data,
          raw: {
            width: frameOverlay.info.width,
            height: frameOverlay.info.height,
            channels: frameOverlay.info.channels,
          },
          left: 0,
          top: 0,
        },
      ])
      .toColourspace(PRODUCTION_STRIP_EXPORT.colourspace)
      .withMetadata({ density: PRODUCTION_STRIP_EXPORT.densityDpi })
      .jpeg(PRODUCTION_STRIP_JPEG_OPTIONS)
      .toBuffer();
    const outputMetadata = await sharp(bytes, { failOn: 'warning' }).metadata();
    if (
      outputMetadata.format !== 'jpeg' ||
      outputMetadata.width !== canvas.width ||
      outputMetadata.height !== canvas.height ||
      outputMetadata.space !== PRODUCTION_STRIP_EXPORT.colourspace ||
      outputMetadata.chromaSubsampling !== PRODUCTION_STRIP_EXPORT.chromaSubsampling ||
      outputMetadata.density !== PRODUCTION_STRIP_EXPORT.densityDpi
    ) {
      throw new AppError(
        'output_metadata',
        'The finished photo did not match the required export metadata.',
      );
    }
    const completedAt = performance.now();
    return {
      bytes,
      width: canvas.width,
      height: canvas.height,
      byteSize: bytes.byteLength,
      timing: {
        validationMs: validationComplete - startedAt,
        slotsMs: slotsComplete - validationComplete,
        compositeMs: completedAt - slotsComplete,
        totalMs: completedAt - startedAt,
      },
    };
  }
}

function validateSignatureAndSize(
  bytes: Uint8Array,
  magic: Buffer,
  label: string,
  maximumBytes: number,
): void {
  if (bytes.byteLength === 0 || bytes.byteLength > maximumBytes) {
    throw new AppError('image_size', `${label} image size is outside the safe limit.`);
  }
  if (!Buffer.from(bytes.subarray(0, magic.length)).equals(magic)) {
    throw new AppError('image_signature', `${label} image signature is invalid.`);
  }
}

function validateMetadata(metadata: Metadata, label: string): void {
  if (
    !metadata.width ||
    !metadata.height ||
    metadata.width > MAX_EDGE ||
    metadata.height > MAX_EDGE ||
    metadata.width * metadata.height > MAX_INPUT_PIXELS ||
    (metadata.pages ?? 1) !== 1 ||
    metadata.channels < 1 ||
    metadata.channels > 4
  ) {
    throw new AppError('image_dimensions', `The ${label} dimensions are outside the safe limit.`);
  }
}

function orientedSize(metadata: Metadata): { width: number; height: number } {
  const autoOrient = metadata.autoOrient;
  if (autoOrient.width && autoOrient.height) {
    return { width: autoOrient.width, height: autoOrient.height };
  }
  if (!metadata.width || !metadata.height) {
    throw new AppError('image_dimensions', 'Image dimensions are unavailable.');
  }
  return { width: metadata.width, height: metadata.height };
}

function slotBox(
  slot: FrameLayout[number],
  canvasWidth: number,
  canvasHeight: number,
): { left: number; top: number; width: number; height: number } {
  const left = Math.round(slot.x * canvasWidth);
  const top = Math.round(slot.y * canvasHeight);
  const right = Math.round((slot.x + slot.width) * canvasWidth);
  const bottom = Math.round((slot.y + slot.height) * canvasHeight);
  return {
    left,
    top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
  };
}

function cropRegion(
  sourceWidth: number,
  sourceHeight: number,
  targetAspect: number,
  focus: CropFocus,
): { left: number; top: number; width: number; height: number } {
  const normalizedFocus = {
    x: Math.max(0, Math.min(1, focus.x)),
    y: Math.max(0, Math.min(1, focus.y)),
  };
  const sourceAspect = sourceWidth / sourceHeight;
  if (sourceAspect > targetAspect) {
    const width = Math.max(1, Math.round(sourceHeight * targetAspect));
    return {
      left: Math.max(
        0,
        Math.min(sourceWidth - width, Math.round(normalizedFocus.x * sourceWidth - width / 2)),
      ),
      top: 0,
      width,
      height: sourceHeight,
    };
  }
  const height = Math.max(1, Math.round(sourceWidth / targetAspect));
  return {
    left: 0,
    top: Math.max(
      0,
      Math.min(sourceHeight - height, Math.round(normalizedFocus.y * sourceHeight - height / 2)),
    ),
    width: sourceWidth,
    height,
  };
}
