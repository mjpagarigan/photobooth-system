import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import sharp from 'sharp';

const TARGET_WIDTH = 1200;
const TARGET_HEIGHT = 3600;
const TRANSPARENT_ALPHA_MAX = 8;
const WINDOW_PADDING = 3;
const MIN_WINDOW_PIXELS = 10_000;

const ALL_TEMPLATES = [
  {
    name: 'Across Ministry',
    sourceFile: 'ACROSS TEMPLATE.png',
    target: 'resources/frames/across-frame.png',
  },
  {
    name: 'B1G Singles Ministry',
    sourceFile: 'B1G TEMPLATE.png',
    target: 'resources/frames/b1g-frame.png',
  },
  {
    name: 'Elevate Youth',
    sourceFile: 'ELEVATE TEMPLATE.png',
    target: 'resources/frames/elevate-frame.png',
  },
  {
    name: 'Exalt Worship Ministry',
    sourceFile: 'EXALT TEMPLATE.png',
    target: 'resources/frames/exalt-frame.png',
  },
  {
    name: 'Host Team',
    sourceFile: 'HOST TEAM TEMPLATE.png',
    target: 'resources/frames/host-team-frame.png',
  },
  {
    name: 'Living Free Ministry',
    sourceFile: 'LIVING FREE MINISTRY TEMPLATE.png',
    target: 'resources/frames/living-free-frame.png',
  },
  {
    name: 'M.A.T. 42nd Anniversary',
    sourceFile: 'MAT TEMPLATE.png',
    target: 'resources/frames/mat-frame.png',
  },
  {
    name: 'Movement Ministry',
    sourceFile: 'MOVEMENT TEMPLATE.png',
    target: 'resources/frames/movement-frame.png',
  },
  {
    name: 'NextGen Ministry',
    sourceFile: 'NEXTGEN TEMPLATE.png',
    target: 'resources/frames/nextgen-frame.png',
  },
  {
    name: 'Ushering Ministry',
    sourceFile: 'USHERING TEMPLATE.png',
    target: 'resources/frames/ushering-frame.png',
  },
  {
    name: 'Women 2 Women (W2W)',
    sourceFile: 'W2W TEMPLATE.png',
    target: 'resources/frames/w2w-frame.png',
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

async function prepareMinistryFrame({ name, source, target }) {
  const sourcePath = resolve(source);
  const targetPath = resolve(target);
  const { data, info } = await sharp(sourcePath)
    .resize(TARGET_WIDTH, TARGET_HEIGHT, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const windows = [
    { minX: Math.round(0.068333 * TARGET_WIDTH), minY: Math.round(0.28 * TARGET_HEIGHT), maxX: Math.round((0.068333 + 0.86) * TARGET_WIDTH) - 1, maxY: Math.round((0.28 + 0.166111) * TARGET_HEIGHT) - 1 },
    { minX: Math.round(0.065 * TARGET_WIDTH), minY: Math.round(0.487778 * TARGET_HEIGHT), maxX: Math.round((0.065 + 0.86) * TARGET_WIDTH) - 1, maxY: Math.round((0.487778 + 0.166667) * TARGET_HEIGHT) - 1 },
    { minX: Math.round(0.068333 * TARGET_WIDTH), minY: Math.round(0.696667 * TARGET_HEIGHT), maxX: Math.round((0.068333 + 0.86) * TARGET_WIDTH) - 1, maxY: Math.round((0.696667 + 0.166667) * TARGET_HEIGHT) - 1 },
  ];

  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const isInside = windows.some((w) => x >= w.minX && x <= w.maxX && y >= w.minY && y <= w.maxY);
      if (isInside) {
        data[(y * info.width + x) * info.channels + 3] = 0;
      }
    }
  }

  await mkdir(dirname(targetPath), { recursive: true });
  await sharp(data, {
    raw: { width: info.width, height: info.height, channels: info.channels },
  })
    .png({ compressionLevel: 9, adaptiveFiltering: false })
    .toFile(targetPath);

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
