import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import sharp from 'sharp';

const TARGET_WIDTH = 1200;
const TARGET_HEIGHT = 3600;
const TRANSPARENT_ALPHA_MAX = 8;
const WINDOW_PADDING = 3;
const MIN_WINDOW_PIXELS = 10_000;

const ALL_TEMPLATES = [
  {
    name: 'NextGen Ministry',
    fileNames: ['1.png', 'NEXTGEN TEMPLATE.png'],
    target: 'resources/frames/nextgen-frame.png',
    slots: [
      { slotIndex: 1, name: 'Photo 1', x: 0.076667, y: 0.222222, width: 0.851667, height: 0.162778, cropMode: 'crop-to-fill' },
      { slotIndex: 2, name: 'Photo 2', x: 0.075, y: 0.430556, width: 0.85, height: 0.162778, cropMode: 'crop-to-fill' },
      { slotIndex: 3, name: 'Photo 3', x: 0.076667, y: 0.638889, width: 0.851667, height: 0.162778, cropMode: 'crop-to-fill' },
    ],
  },
  {
    name: 'B1G Singles Ministry',
    fileNames: ['2.png', 'B1G TEMPLATE.png'],
    target: 'resources/frames/b1g-frame.png',
    slots: [
      { slotIndex: 1, name: 'Photo 1', x: 0.068333, y: 0.226667, width: 0.85, height: 0.162222, cropMode: 'crop-to-fill' },
      { slotIndex: 2, name: 'Photo 2', x: 0.065, y: 0.435, width: 0.85, height: 0.162778, cropMode: 'crop-to-fill' },
      { slotIndex: 3, name: 'Photo 3', x: 0.068333, y: 0.642778, width: 0.85, height: 0.163333, cropMode: 'crop-to-fill' },
    ],
  },
  {
    name: 'Across Ministry',
    fileNames: ['3.png', 'ACROSS TEMPLATE.png'],
    target: 'resources/frames/across-frame.png',
    slots: [
      { slotIndex: 1, name: 'Photo 1', x: 0.076667, y: 0.208889, width: 0.85, height: 0.162222, cropMode: 'crop-to-fill' },
      { slotIndex: 2, name: 'Photo 2', x: 0.073333, y: 0.417222, width: 0.85, height: 0.162778, cropMode: 'crop-to-fill' },
      { slotIndex: 3, name: 'Photo 3', x: 0.076667, y: 0.625, width: 0.85, height: 0.163333, cropMode: 'crop-to-fill' },
    ],
  },
  {
    name: 'Movement Ministry',
    fileNames: ['4.png', 'MOVEMENT TEMPLATE.png'],
    target: 'resources/frames/movement-frame.png',
    slots: [
      { slotIndex: 1, name: 'Photo 1', x: 0.076667, y: 0.2, width: 0.85, height: 0.162778, cropMode: 'crop-to-fill' },
      { slotIndex: 2, name: 'Photo 2', x: 0.073333, y: 0.408333, width: 0.85, height: 0.162778, cropMode: 'crop-to-fill' },
      { slotIndex: 3, name: 'Photo 3', x: 0.076667, y: 0.616667, width: 0.85, height: 0.162778, cropMode: 'crop-to-fill' },
    ],
  },
  {
    name: 'Women 2 Women (W2W)',
    fileNames: ['5.png', 'W2W TEMPLATE.png'],
    target: 'resources/frames/w2w-frame.png',
    slots: [
      { slotIndex: 1, name: 'Photo 1', x: 0.076667, y: 0.234444, width: 0.848333, height: 0.162778, cropMode: 'crop-to-fill' },
      { slotIndex: 2, name: 'Photo 2', x: 0.075, y: 0.443333, width: 0.848333, height: 0.162222, cropMode: 'crop-to-fill' },
      { slotIndex: 3, name: 'Photo 3', x: 0.076667, y: 0.651111, width: 0.848333, height: 0.162778, cropMode: 'crop-to-fill' },
    ],
  },
  {
    name: 'Living Free Ministry',
    fileNames: ['6.png', 'LIVING FREE MINISTRY TEMPLATE.png'],
    target: 'resources/frames/living-free-frame.png',
    slots: [
      { slotIndex: 1, name: 'Photo 1', x: 0.076667, y: 0.21, width: 0.85, height: 0.162778, cropMode: 'crop-to-fill' },
      { slotIndex: 2, name: 'Photo 2', x: 0.073333, y: 0.418889, width: 0.85, height: 0.162222, cropMode: 'crop-to-fill' },
      { slotIndex: 3, name: 'Photo 3', x: 0.076667, y: 0.626667, width: 0.85, height: 0.162778, cropMode: 'crop-to-fill' },
    ],
  },
  {
    name: 'Host Team',
    fileNames: ['7.png', 'HOST TEAM TEMPLATE.png'],
    target: 'resources/frames/host-team-frame.png',
    slots: [
      { slotIndex: 1, name: 'Photo 1', x: 0.076667, y: 0.228889, width: 0.85, height: 0.162778, cropMode: 'crop-to-fill' },
      { slotIndex: 2, name: 'Photo 2', x: 0.073333, y: 0.437778, width: 0.85, height: 0.162222, cropMode: 'crop-to-fill' },
      { slotIndex: 3, name: 'Photo 3', x: 0.076667, y: 0.645556, width: 0.85, height: 0.163333, cropMode: 'crop-to-fill' },
    ],
  },
  {
    name: 'Ushering Ministry',
    fileNames: ['8.png', 'USHERING TEMPLATE.png'],
    target: 'resources/frames/ushering-frame.png',
    slots: [
      { slotIndex: 1, name: 'Photo 1', x: 0.076667, y: 0.267778, width: 0.85, height: 0.162778, cropMode: 'crop-to-fill' },
      { slotIndex: 2, name: 'Photo 2', x: 0.073333, y: 0.476667, width: 0.85, height: 0.162222, cropMode: 'crop-to-fill' },
      { slotIndex: 3, name: 'Photo 3', x: 0.076667, y: 0.684444, width: 0.85, height: 0.163333, cropMode: 'crop-to-fill' },
    ],
  },
  {
    name: 'Exalt Worship Ministry',
    fileNames: ['9.png', 'EXALT TEMPLATE.png'],
    target: 'resources/frames/exalt-frame.png',
    slots: [
      { slotIndex: 1, name: 'Photo 1', x: 0.076667, y: 0.216667, width: 0.85, height: 0.162222, cropMode: 'crop-to-fill' },
      { slotIndex: 2, name: 'Photo 2', x: 0.073333, y: 0.425, width: 0.85, height: 0.162778, cropMode: 'crop-to-fill' },
      { slotIndex: 3, name: 'Photo 3', x: 0.076667, y: 0.633333, width: 0.85, height: 0.162778, cropMode: 'crop-to-fill' },
    ],
  },
  {
    name: 'Elevate Youth',
    fileNames: ['10.png', 'ELEVATE TEMPLATE.png'],
    target: 'resources/frames/elevate-frame.png',
    slots: [
      { slotIndex: 1, name: 'Photo 1', x: 0.076667, y: 0.228889, width: 0.85, height: 0.162778, cropMode: 'crop-to-fill' },
      { slotIndex: 2, name: 'Photo 2', x: 0.073333, y: 0.437778, width: 0.85, height: 0.162222, cropMode: 'crop-to-fill' },
      { slotIndex: 3, name: 'Photo 3', x: 0.076667, y: 0.645556, width: 0.85, height: 0.162778, cropMode: 'crop-to-fill' },
    ],
  },
  {
    name: 'M.A.T. Ministry',
    fileNames: ['11.png', 'MAT TEMPLATE.png'],
    target: 'resources/frames/mat-ministry-frame.png',
    slots: [
      { slotIndex: 1, name: 'Photo 1', x: 0.071667, y: 0.236667, width: 0.85, height: 0.162778, cropMode: 'crop-to-fill' },
      { slotIndex: 2, name: 'Photo 2', x: 0.068333, y: 0.445, width: 0.85, height: 0.162778, cropMode: 'crop-to-fill' },
      { slotIndex: 3, name: 'Photo 3', x: 0.071667, y: 0.653333, width: 0.85, height: 0.162778, cropMode: 'crop-to-fill' },
    ],
  },
];

const allTemplatesArgument = process.argv.indexOf('--all');
const templateDir = allTemplatesArgument >= 0 ? process.argv[allTemplatesArgument + 1] : null;

if (allTemplatesArgument >= 0 && !templateDir) {
  throw new Error(
    'Usage: pnpm --filter @grace-booth/kiosk frames:prepare --all <template-directory>',
  );
}

const { existsSync } = await import('node:fs');

if (templateDir) {
  for (const item of ALL_TEMPLATES) {
    let chosenSource = null;
    for (const fn of item.fileNames) {
      const p = `${templateDir}/${fn}`;
      if (existsSync(p)) {
        chosenSource = p;
        break;
      }
    }
    if (!chosenSource) continue;
    await prepareMinistryFrame({
      name: item.name,
      source: chosenSource,
      target: item.target,
      slots: item.slots,
    });
    if (item.name === 'M.A.T. Ministry') {
      await prepareMinistryFrame({
        name: 'M.A.T. Frame',
        source: chosenSource,
        target: 'resources/frames/mat-frame.png',
        slots: item.slots,
      });
      await prepareMinistryFrame({
        name: 'Default Frame',
        source: chosenSource,
        target: 'resources/frames/default-frame.png',
        slots: item.slots,
      });
    } else if (item.name === 'NextGen Ministry') {
      await prepareMinistryFrame({
        name: '42nd Anniversary Frame',
        source: chosenSource,
        target: 'resources/frames/anniv-frame.png',
        slots: item.slots,
      });
    }
  }
} else {
  if (!process.argv[2] || !process.argv[3]) {
    throw new Error(
      'Usage: pnpm --filter @grace-booth/kiosk frames:prepare <mat.png> <anniversary.png>',
    );
  }
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
  const sourceBytes = await readFile(sourcePath);
  const image = sharp(sourceBytes, { failOn: 'warning' });
  const metadata = await image.metadata();
  if (
    metadata.format !== 'png' ||
    !metadata.hasAlpha ||
    !metadata.width ||
    !metadata.height ||
    metadata.width * 3 !== metadata.height
  ) {
    throw new Error(
      `${name} must be a transparent 1:3 PNG; received ${metadata.format ?? 'unknown'} ${metadata.width ?? 0}x${metadata.height ?? 0}`,
    );
  }
  const alpha = (await image.stats()).channels.at(-1);
  if (alpha?.min === undefined || alpha.min >= 255) {
    throw new Error(`${name} must contain transparent photo windows`);
  }

  await mkdir(dirname(targetPath), { recursive: true });
  let written = false;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      try { await unlink(targetPath); } catch {
        // The first generation has no previous target to remove.
      }
      // Preserve the designer-authored alpha mask exactly. Opaque foreground details can
      // intentionally overlap a transparent photo window and must not be cleared here.
      await writeFile(targetPath, sourceBytes);
      written = true;
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  if (!written) {
    await writeFile(targetPath, sourceBytes);
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
