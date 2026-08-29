import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import sharp from 'sharp';

const TARGET_WIDTH = 1200;
const TARGET_HEIGHT = 3600;
const TRANSPARENT_ALPHA_MAX = 8;
const WINDOW_PADDING = 3;
const MIN_WINDOW_PIXELS = 10_000;

const createMinistrySlots = (
  s1Y,
  s2Y,
  s3Y,
  s1X = 0.075,
  s2X = 0.073333,
  s3X = 0.075,
  width = 0.853333,
  height = 0.163333,
) => [
  { slotIndex: 1, name: 'Photo 1', x: s1X, y: s1Y, width, height, cropMode: 'crop-to-fill' },
  { slotIndex: 2, name: 'Photo 2', x: s2X, y: s2Y, width, height, cropMode: 'crop-to-fill' },
  { slotIndex: 3, name: 'Photo 3', x: s3X, y: s3Y, width, height, cropMode: 'crop-to-fill' },
];

const ALL_TEMPLATES = [
  {
    name: 'Across Ministry',
    sourceFile: 'ACROSS TEMPLATE.png',
    target: 'resources/frames/across-frame.png',
    slots: createMinistrySlots(0.208333, 0.416667, 0.625),
  },
  {
    name: 'B1G Singles Ministry',
    sourceFile: 'B1G TEMPLATE.png',
    target: 'resources/frames/b1g-frame.png',
    slots: createMinistrySlots(0.226111, 0.434444, 0.642778, 0.068333, 0.065, 0.068333, 0.851667),
  },
  {
    name: 'Elevate Youth',
    sourceFile: 'ELEVATE TEMPLATE.png',
    target: 'resources/frames/elevate-frame.png',
    slots: createMinistrySlots(0.228889, 0.437222, 0.645556),
  },
  {
    name: 'Exalt Worship Ministry',
    sourceFile: 'EXALT TEMPLATE.png',
    target: 'resources/frames/exalt-frame.png',
    slots: createMinistrySlots(0.216111, 0.425, 0.633333),
  },
  {
    name: 'Host Team',
    sourceFile: 'HOST TEAM TEMPLATE.png',
    target: 'resources/frames/host-team-frame.png',
    slots: createMinistrySlots(0.228889, 0.437222, 0.645556),
  },
  {
    name: 'Living Free Ministry',
    sourceFile: 'LIVING FREE MINISTRY TEMPLATE.png',
    target: 'resources/frames/living-free-frame.png',
    slots: createMinistrySlots(0.21, 0.418333, 0.626667),
  },
  {
    name: 'M.A.T. Ministry',
    sourceFile: 'MAT TEMPLATE.png',
    target: 'resources/frames/mat-ministry-frame.png',
    slots: createMinistrySlots(0.236111, 0.445, 0.653333, 0.07, 0.066667, 0.07, 0.851667),
  },
  {
    name: 'Movement Ministry',
    sourceFile: 'MOVEMENT TEMPLATE.png',
    target: 'resources/frames/movement-frame.png',
    slots: createMinistrySlots(0.199444, 0.408333, 0.616111),
  },
  {
    name: 'NextGen Ministry',
    sourceFile: 'NEXTGEN TEMPLATE.png',
    target: 'resources/frames/nextgen-frame.png',
    slots: createMinistrySlots(0.221667, 0.430556, 0.638333),
  },
  {
    name: 'Ushering Ministry',
    sourceFile: 'USHERING TEMPLATE.png',
    target: 'resources/frames/ushering-frame.png',
    slots: createMinistrySlots(0.267778, 0.476111, 0.684444),
  },
  {
    name: 'Women 2 Women (W2W)',
    sourceFile: 'W2W TEMPLATE.png',
    target: 'resources/frames/w2w-frame.png',
    slots: createMinistrySlots(0.234444, 0.442778, 0.651111),
  },
];

const templateDir = process.argv[2] === '--all' || !process.argv[2]
  ? 'C:/Users/padil/mj/photolayout-templates'
  : null;

if (templateDir) {
  for (const item of ALL_TEMPLATES) {
    const source = `${templateDir}/${item.sourceFile}`;
    await prepareMinistryFrame({
      name: item.name,
      source,
      target: item.target,
      slots: item.slots,
    });
  }
} else {
  const inputs = [
    {
      name: 'M.A.T. Anniversary',
      source: process.argv[2],
      target: process.argv[4] ?? 'resources/frames/mat-frame.png',
    },
    {
      name: '42nd Anniversary',
      source: process.argv[3],
      target: process.argv[5] ?? 'resources/frames/anniv-frame.png',
    },
  ];

  for (const input of inputs) {
    await prepareFrame(input);
  }
}

async function prepareMinistryFrame({ name, source, target, slots }) {
  const sourcePath = resolve(source);
  const targetPath = resolve(target);
  const { data, info } = await sharp(sourcePath)
    .resize(TARGET_WIDTH, TARGET_HEIGHT, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const windows = slots.map((slot) => ({
    minX: Math.round(slot.x * TARGET_WIDTH),
    minY: Math.round(slot.y * TARGET_HEIGHT),
    maxX: Math.round((slot.x + slot.width) * TARGET_WIDTH) - 1,
    maxY: Math.round((slot.y + slot.height) * TARGET_HEIGHT) - 1,
  }));

  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const isInside = windows.some((w) => x >= w.minX && x <= w.maxX && y >= w.minY && y <= w.maxY);
      if (isInside) {
        data[(y * info.width + x) * info.channels + 3] = 0;
      }
    }
  }

  await mkdir(dirname(targetPath), { recursive: true });
  const pngBuffer = await sharp(data, {
    raw: { width: info.width, height: info.height, channels: info.channels },
  })
    .png({ compressionLevel: 9, adaptiveFiltering: false })
    .toBuffer();

  const { writeFile, unlink } = await import('node:fs/promises');
  let written = false;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      try { await unlink(targetPath); } catch {}
      await writeFile(targetPath, pngBuffer);
      written = true;
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  if (!written) {
    await writeFile(targetPath, pngBuffer);
  }

  process.stdout.write(`Generated ${name}: ${targetPath}\n`);
}

async function prepareFrame({ name, source, target }) {
  const sourcePath = resolve(source);
  const targetPath = resolve(target);
  const { data, info } = await sharp(sourcePath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  if (info.width * 3 !== info.height) {
    throw new Error(`${name} must use a 1:3 aspect ratio; received ${info.width}x${info.height}`);
  }

  const components = findTransparentComponents(data, info)
    .filter((component) => component.pixelCount >= MIN_WINDOW_PIXELS)
    .sort((left, right) => right.pixelCount - left.pixelCount)
    .slice(0, 3)
    .sort((left, right) => left.minY - right.minY);

  if (components.length !== 3) {
    throw new Error(`${name} must contain exactly three dominant transparent photo windows`);
  }

  const windows = components.map((component) => ({
    minX: Math.max(0, component.minX - WINDOW_PADDING),
    minY: Math.max(0, component.minY - WINDOW_PADDING),
    maxX: Math.min(info.width - 1, component.maxX + WINDOW_PADDING),
    maxY: Math.min(info.height - 1, component.maxY + WINDOW_PADDING),
  }));

  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const insidePhotoWindow = windows.some(
        (window) => x >= window.minX && x <= window.maxX && y >= window.minY && y <= window.maxY,
      );
      if (!insidePhotoWindow) {
        data[(y * info.width + x) * info.channels + 3] = 255;
      }
    }
  }

  await mkdir(dirname(targetPath), { recursive: true });
  await sharp(data, {
    raw: { width: info.width, height: info.height, channels: info.channels },
  })
    .resize(TARGET_WIDTH, TARGET_HEIGHT, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .png({ compressionLevel: 9, adaptiveFiltering: false })
    .toFile(targetPath);

  const slots = windows.map((window, index) => ({
    slotIndex: index + 1,
    name: `Photo ${index + 1}`,
    x: round(window.minX / info.width),
    y: round(window.minY / info.height),
    width: round((window.maxX - window.minX + 1) / info.width),
    height: round((window.maxY - window.minY + 1) / info.height),
    cropMode: 'crop-to-fill',
  }));

  process.stdout.write(`${name}: ${targetPath}\n${JSON.stringify(slots, null, 2)}\n`);
}

function findTransparentComponents(data, info) {
  const seen = new Uint8Array(info.width * info.height);
  const components = [];

  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const start = y * info.width + x;
      if (seen[start] || alphaAt(data, info, start) > TRANSPARENT_ALPHA_MAX) continue;

      const stack = [start];
      let pixelCount = 0;
      let minX = x;
      let maxX = x;
      let minY = y;
      let maxY = y;
      seen[start] = 1;

      while (stack.length > 0) {
        const current = stack.pop();
        const currentX = current % info.width;
        const currentY = Math.floor(current / info.width);
        pixelCount += 1;
        minX = Math.min(minX, currentX);
        maxX = Math.max(maxX, currentX);
        minY = Math.min(minY, currentY);
        maxY = Math.max(maxY, currentY);

        for (const next of [current - 1, current + 1, current - info.width, current + info.width]) {
          if (next < 0 || next >= seen.length || seen[next]) continue;
          const nextX = next % info.width;
          const nextY = Math.floor(next / info.width);
          if (Math.abs(nextX - currentX) + Math.abs(nextY - currentY) !== 1) continue;
          if (alphaAt(data, info, next) <= TRANSPARENT_ALPHA_MAX) {
            seen[next] = 1;
            stack.push(next);
          }
        }
      }

      components.push({ pixelCount, minX, maxX, minY, maxY });
    }
  }

  return components;
}

function alphaAt(data, info, pixelIndex) {
  return data[pixelIndex * info.channels + 3];
}

function round(value) {
  return Number(value.toFixed(6));
}
