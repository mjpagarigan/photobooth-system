import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  CenterCropStrategy,
  FaceAwareWithCenterFallback,
  MediaPipeCropStrategy,
} from '../../src/main/image/crop-strategy.js';
import { ImagePipeline } from '../../src/main/image/image-pipeline.js';
import {
  PRODUCTION_STRIP_EXPORT,
  PRODUCTION_STRIP_JPEG_OPTIONS,
} from '../../src/main/image/strip-export-config.js';
import { DEFAULT_FRAME_SLOTS } from '../../src/main/frame/frame-service.js';

let fixturePhotos: [Buffer, Buffer, Buffer];
let fixtureFrame: Buffer;
let pipelineSource: string;

beforeAll(async () => {
  const root = fileURLToPath(new URL('../../resources/', import.meta.url));
  fixturePhotos = (await Promise.all(
    [1, 2, 3].map((index) => readFile(`${root}mock/photo-${index}.jpg`)),
  )) as [Buffer, Buffer, Buffer];
  fixtureFrame = await readFile(`${root}frames/mat-frame.png`);
  pipelineSource = await readFile(
    fileURLToPath(new URL('../../src/main/image/image-pipeline.ts', import.meta.url)),
    'utf8',
  );
});

describe('deterministic Sharp collage pipeline', () => {
  it('matches the fixture golden within the documented pixel tolerance', async () => {
    const pipeline = new ImagePipeline(
      new FaceAwareWithCenterFallback(new MediaPipeCropStrategy()),
    );
    const input = {
      captures: fixturePhotos,
      framePng: fixtureFrame,
      slots: DEFAULT_FRAME_SLOTS,
    } as const;
    const [golden, repeat] = await Promise.all([pipeline.process(input), pipeline.process(input)]);
    const goldenPixels = await sharp(golden.bytes).removeAlpha().raw().toBuffer();
    const repeatPixels = await sharp(repeat.bytes).removeAlpha().raw().toBuffer();
    const comparison = pixelDifference(goldenPixels, repeatPixels);
    expect(comparison.meanChannelDelta).toBeLessThanOrEqual(1.5);
    expect(comparison.fractionOverEight).toBeLessThanOrEqual(0.01);
    expect(golden.height).toBe(3_600);
    expect(golden.width).toBe(1_200);
    const metadata = await sharp(golden.bytes).metadata();
    expect(metadata).toMatchObject({
      format: 'jpeg',
      width: 1_200,
      height: 3_600,
      space: 'srgb',
      chromaSubsampling: '4:4:4',
      density: 600,
    });
  }, 30_000);

  it('places every capture inside its cutout on the shipped default frame', async () => {
    const colors = [
      { r: 235, g: 35, b: 35 },
      { r: 30, g: 210, b: 70 },
      { r: 35, g: 70, b: 230 },
    ];
    const captures = (await Promise.all(
      colors.map((background) =>
        sharp({ create: { width: 1_600, height: 1_200, channels: 3, background } })
          .jpeg({ quality: 100, chromaSubsampling: '4:4:4' })
          .toBuffer(),
      ),
    )) as [Buffer, Buffer, Buffer];
    const result = await new ImagePipeline(new CenterCropStrategy()).process({
      captures,
      framePng: fixtureFrame,
      slots: DEFAULT_FRAME_SLOTS,
    });

    for (const slot of DEFAULT_FRAME_SLOTS) {
      const expected = colors[slot.slotIndex - 1];
      if (!expected) throw new Error('missing expected colour');
      const centerX = Math.round((slot.x + slot.width / 2) * result.width);
      const samples = [
        { x: centerX, y: Math.round((slot.y + slot.height / 2) * result.height) },
        { x: centerX, y: Math.round((slot.y + 0.02) * result.height) },
        { x: centerX, y: Math.round((slot.y + slot.height - 0.02) * result.height) },
      ];
      for (const sample of samples) {
        const pixel = await pixelAt(result.bytes, sample.x, sample.y);
        expect(Math.abs(pixel.r - expected.r)).toBeLessThanOrEqual(12);
        expect(Math.abs(pixel.g - expected.g)).toBeLessThanOrEqual(12);
        expect(Math.abs(pixel.b - expected.b)).toBeLessThanOrEqual(12);
      }
    }

    // Top header stays opaque frame artwork, not guest photo.
    const header = await pixelAt(
      result.bytes,
      Math.round(0.5 * result.width),
      Math.round(0.04 * result.height),
    );
    expect(header.r).toBeGreaterThan(100);
  }, 30_000);

  it('uses slotIndex rather than array order when selecting captures', async () => {
    const colors = [
      { r: 235, g: 35, b: 35 },
      { r: 30, g: 210, b: 70 },
      { r: 35, g: 70, b: 230 },
    ];
    const captures = (await Promise.all(
      colors.map((background) =>
        sharp({ create: { width: 300, height: 200, channels: 3, background } })
          .jpeg({ quality: 100, chromaSubsampling: '4:4:4' })
          .toBuffer(),
      ),
    )) as [Buffer, Buffer, Buffer];
    const frame = await transparentPng(300, 900);
    const slots = [...DEFAULT_FRAME_SLOTS].reverse();
    const result = await new ImagePipeline(new CenterCropStrategy()).process({
      captures,
      framePng: frame,
      slots,
    });
    const slot1 = DEFAULT_FRAME_SLOTS[0]!;
    const topSlot = await pixelAt(
      result.bytes,
      Math.round(result.width * (slot1.x + slot1.width / 2)),
      Math.round(result.height * (slot1.y + slot1.height / 2)),
    );
    expect(topSlot.r).toBeGreaterThan(200);
    expect(topSlot.g).toBeLessThan(80);
    expect(topSlot.b).toBeLessThan(80);
  }, 20_000);

  it('keeps fit letterboxing distinct from crop-to-fill', async () => {
    const wide = await sharp({
      create: { width: 800, height: 120, channels: 3, background: '#d51f35' },
    })
      .jpeg({ quality: 100 })
      .toBuffer();
    const frame = await transparentPng(300, 900);
    const fitSlots = DEFAULT_FRAME_SLOTS.map((slot) =>
      slot.slotIndex === 1 ? { ...slot, cropMode: 'fit' as const } : slot,
    );
    const result = await new ImagePipeline(new CenterCropStrategy()).process({
      captures: [wide, wide, wide],
      framePng: frame,
      slots: fitSlots,
    });
    const slot1 = DEFAULT_FRAME_SLOTS[0]!;
    const letterbox = await pixelAt(
      result.bytes,
      Math.round(result.width * (slot1.x + slot1.width / 2)),
      Math.round(result.height * (slot1.y + 0.01)),
    );
    expect(letterbox.r).toBeGreaterThan(220);
    expect(letterbox.g).toBeGreaterThan(220);
    expect(letterbox.b).toBeGreaterThan(215);
  }, 20_000);

  it('corrects EXIF orientation and falls back to center when MediaPipe is unavailable', async () => {
    const oriented = await sharp({
      create: { width: 160, height: 320, channels: 3, background: '#3159b8' },
    })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const frame = await transparentPng(300, 900);
    const fallback = new ImagePipeline(
      new FaceAwareWithCenterFallback(new MediaPipeCropStrategy()),
    );
    const center = new ImagePipeline(new CenterCropStrategy());
    const input = {
      captures: [oriented, oriented, oriented],
      framePng: frame,
      slots: DEFAULT_FRAME_SLOTS,
    } as const;
    const [fallbackResult, centerResult] = await Promise.all([
      fallback.process(input),
      center.process(input),
    ]);
    expect(fallbackResult.bytes.equals(centerResult.bytes)).toBe(true);
  }, 30_000);

  it('rejects corrupt source signatures and fully opaque frame PNGs', async () => {
    const pipeline = new ImagePipeline(new CenterCropStrategy());
    await expect(
      pipeline.process({
        captures: [Buffer.from('bad'), ...fixturePhotos.slice(1)] as [Buffer, Buffer, Buffer],
        framePng: fixtureFrame,
        slots: DEFAULT_FRAME_SLOTS,
      }),
    ).rejects.toThrow(/signature/i);
    const opaque = await sharp({
      create: {
        width: 300,
        height: 900,
        channels: 4,
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      },
    })
      .png()
      .toBuffer();
    await expect(
      pipeline.process({
        captures: fixturePhotos,
        framePng: opaque,
        slots: DEFAULT_FRAME_SLOTS,
      }),
    ).rejects.toThrow(/transparent/i);
  });

  it('requires one capture per slot and preserves arbitrary frame geometry', async () => {
    const pipeline = new ImagePipeline(new CenterCropStrategy());
    await expect(
      pipeline.process({
        captures: fixturePhotos.slice(0, 2),
        framePng: fixtureFrame,
        slots: DEFAULT_FRAME_SLOTS,
      }),
    ).rejects.toThrow(/exactly 3/i);

    const nearAspect = await transparentPng(1_200, 3_599);
    const result = await pipeline.process({
      captures: fixturePhotos,
      framePng: nearAspect,
      slots: DEFAULT_FRAME_SLOTS,
    });
    expect(result.width).toBe(1_200);
    expect(result.height).toBe(3_599);
  });

  it('keeps the immutable production encoder contract without a fixed byte ceiling', () => {
    expect(PRODUCTION_STRIP_EXPORT).toMatchObject({
      width: 1_200,
      height: 3_600,
      aspectRatio: 1 / 3,
      jpegQuality: 95,
      chromaSubsampling: '4:4:4',
      mozjpeg: true,
      colourspace: 'srgb',
      densityDpi: 600,
    });
    expect(PRODUCTION_STRIP_JPEG_OPTIONS).toEqual({
      quality: 95,
      chromaSubsampling: '4:4:4',
      mozjpeg: true,
    });
    expect(Object.isFrozen(PRODUCTION_STRIP_EXPORT)).toBe(true);
    expect(pipelineSource.match(/\.jpeg\(/gu)).toHaveLength(1);
    expect(PRODUCTION_STRIP_EXPORT).not.toHaveProperty('maximumByteSize');
  });

  it('uses an injected face result and calls center only when the provider returns null', async () => {
    let fallbackCalls = 0;
    const faceAware = new FaceAwareWithCenterFallback(
      { name: 'injected-face', locateFace: () => Promise.resolve({ x: 0.2, y: 0.3 }) },
      {
        name: 'tracked-center',
        locateFace: () => {
          fallbackCalls += 1;
          return Promise.resolve({ x: 0.5, y: 0.5 });
        },
      },
    );
    await expect(faceAware.locateFace(fixturePhotos[0])).resolves.toEqual({ x: 0.2, y: 0.3 });
    expect(fallbackCalls).toBe(0);

    const unavailable = new FaceAwareWithCenterFallback({
      name: 'unavailable',
      locateFace: () => Promise.resolve(null),
    });
    await expect(unavailable.locateFace(fixturePhotos[0])).resolves.toEqual({ x: 0.5, y: 0.5 });
  });
});

async function transparentPng(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0.001 } },
  })
    .png()
    .toBuffer();
}

async function pixelAt(
  image: Buffer,
  x: number,
  y: number,
): Promise<{ r: number; g: number; b: number }> {
  const pixel = await sharp(image)
    .extract({ left: x, top: y, width: 1, height: 1 })
    .raw()
    .toBuffer();
  return { r: pixel[0] ?? 0, g: pixel[1] ?? 0, b: pixel[2] ?? 0 };
}

function pixelDifference(
  expected: Buffer,
  actual: Buffer,
): { meanChannelDelta: number; fractionOverEight: number } {
  expect(actual.byteLength).toBe(expected.byteLength);
  let total = 0;
  let pixelsOverEight = 0;
  for (let offset = 0; offset < expected.length; offset += 3) {
    let pixelOver = false;
    for (let channel = 0; channel < 3; channel += 1) {
      const delta = Math.abs((expected[offset + channel] ?? 0) - (actual[offset + channel] ?? 0));
      total += delta;
      if (delta > 8) pixelOver = true;
    }
    if (pixelOver) pixelsOverEight += 1;
  }
  return {
    meanChannelDelta: total / expected.length,
    fractionOverEight: pixelsOverEight / (expected.length / 3),
  };
}
