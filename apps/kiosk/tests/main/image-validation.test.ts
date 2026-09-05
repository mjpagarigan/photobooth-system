import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import {
  isSafeSourceByteLength,
  isSafeSourceGeometry,
  normalizeFramePng,
  validateSourceJpeg,
} from '../../src/main/image/image-validation.js';

describe('worker-side source image safety limits', () => {
  it('enforces the exact 50 MiB source boundary', () => {
    expect(isSafeSourceByteLength(50 * 1024 * 1024)).toBe(true);
    expect(isSafeSourceByteLength(50 * 1024 * 1024 + 1)).toBe(false);
  });

  it('enforces exact 80 MP, 12,000-edge, single-page, and four-channel geometry', () => {
    expect(isSafeSourceGeometry(10_000, 8_000, 1, 4)).toBe(true);
    expect(isSafeSourceGeometry(10_000, 8_001, 1, 4)).toBe(false);
    expect(isSafeSourceGeometry(12_000, 6_666, 1, 3)).toBe(true);
    expect(isSafeSourceGeometry(12_001, 1, 1, 3)).toBe(false);
    expect(isSafeSourceGeometry(1_000, 1_000, 2, 3)).toBe(false);
    expect(isSafeSourceGeometry(1_000, 1_000, 1, 5)).toBe(false);
  });

  it('fully decodes valid JPEGs and rejects corrupt JPEG payloads after metadata', async () => {
    const valid = await sharp({
      create: { width: 40, height: 30, channels: 3, background: '#3159b8' },
    })
      .jpeg()
      .toBuffer();
    await expect(validateSourceJpeg(valid)).resolves.toEqual({ width: 40, height: 30 });
    await expect(
      validateSourceJpeg(valid.subarray(0, Math.floor(valid.length / 2))),
    ).rejects.toThrow();
  });
});

describe('frame PNG normalization', () => {
  it('rejects an opaque PNG without transparency', async () => {
    const opaque = await sharp({
      create: { width: 1200, height: 3600, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } },
    })
      .png()
      .toBuffer();
    await expect(normalizeFramePng(opaque)).rejects.toThrow(/transparent pixels/i);
  });

  it('accepts a transparent PNG at an arbitrary aspect ratio', async () => {
    const square = await sharp({
      create: { width: 1000, height: 1000, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .png()
      .toBuffer();
    const result = await normalizeFramePng(square);
    expect(result.width).toBe(1000);
    expect(result.height).toBe(1000);
  });

  it('preserves the uploaded frame dimensions', async () => {
    const halfScale = await sharp({
      create: { width: 600, height: 1800, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .png()
      .toBuffer();
    const result = await normalizeFramePng(halfScale);
    expect(result.width).toBe(600);
    expect(result.height).toBe(1800);
  });

  it('accepts and preserves a valid 1200x3600 transparent PNG', async () => {
    const fullScale = await sharp({
      create: { width: 1200, height: 3600, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .png()
      .toBuffer();
    const result = await normalizeFramePng(fullScale);
    expect(result.width).toBe(1200);
    expect(result.height).toBe(3600);
  });
});
