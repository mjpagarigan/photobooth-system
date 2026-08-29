import { fileURLToPath } from 'node:url';

import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { MINISTRY_FRAMES } from '../../src/main/frame/frame-service.js';

const FRAMES_ROOT = fileURLToPath(new URL('../../resources/frames/', import.meta.url));

describe('packaged ministry frame assets', () => {
  it('ships all 11 layouts as transparent 1:3 PNGs with open photo windows', async () => {
    expect(MINISTRY_FRAMES).toHaveLength(11);

    for (const frame of MINISTRY_FRAMES) {
      const image = sharp(`${FRAMES_ROOT}${frame.file}`);
      const metadata = await image.metadata();
      const stats = await image.stats();

      expect(metadata, frame.file).toMatchObject({ format: 'png', hasAlpha: true });
      expect(metadata.width, frame.file).toBeTruthy();
      expect(metadata.height, frame.file).toBe(metadata.width * 3);
      expect(stats.channels.at(-1)?.min, frame.file).toBe(0);

      for (const slot of frame.slots) {
        const alpha = await alphaAt(image, slot.x + slot.width / 2, slot.y + slot.height / 2);
        expect(alpha, `${frame.file} slot ${slot.slotIndex}`).toBeLessThanOrEqual(16);
      }
    }
  });

  it('preserves intentional foreground artwork inside transparent windows', async () => {
    const matFrame = sharp(`${FRAMES_ROOT}mat-ministry-frame.png`);

    // The final M.A.T. template places an opaque red LIVE badge over the first photo window.
    // A fully transparent center immediately beside it confirms this is overlay art, not opacity.
    await expect(alphaAt(matFrame, 0.85, 0.26)).resolves.toBeGreaterThanOrEqual(240);
    await expect(alphaAt(matFrame, 0.5, 0.3)).resolves.toBeLessThanOrEqual(16);
  });
});

async function alphaAt(image: ReturnType<typeof sharp>, x: number, y: number): Promise<number> {
  const metadata = await image.metadata();
  if (!metadata.width || !metadata.height) throw new Error('Frame dimensions are unavailable');
  const pixel = await image
    .clone()
    .ensureAlpha()
    .extract({
      left: Math.min(metadata.width - 1, Math.floor(x * metadata.width)),
      top: Math.min(metadata.height - 1, Math.floor(y * metadata.height)),
      width: 1,
      height: 1,
    })
    .raw()
    .toBuffer();
  return pixel[3] ?? 255;
}
