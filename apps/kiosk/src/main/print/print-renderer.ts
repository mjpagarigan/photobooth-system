import type { PaperMargins } from '@grace-booth/shared';
import { PRINT_4R_ASPECT } from '@grace-booth/shared';
import sharp, { type OverlayOptions } from 'sharp';

import { AppError } from '../errors.js';
import { placeOn4rLandscape, type PrintPlacement } from './print-layout.js';

const MAX_INPUT_PIXELS = 80_000_000;
const WHITE = { r: 255, g: 255, b: 255, alpha: 1 } as const;

export type PrintRenderOptions = {
  margins: PaperMargins | null;
  dpi: number;
  /** Absolute path of an operator-supplied printer ICC profile, or null to stay sRGB. */
  iccProfilePath: string | null;
};

export type RenderedPrintPage = { png: Buffer; placement: PrintPlacement };

/** Places a finished photo on a white landscape 6 × 4 in page (decision A: fit, never crop). */
export async function renderPhotoPage(
  photo: Uint8Array,
  options: PrintRenderOptions,
): Promise<RenderedPrintPage> {
  const image = sharp(photo, { failOn: 'warning', limitInputPixels: MAX_INPUT_PIXELS }).rotate();
  const metadata = await image.metadata();
  const width = metadata.autoOrient.width;
  const height = metadata.autoOrient.height;
  if (!width || !height) throw new AppError('print_source_invalid', 'The photo could not be read.');
  const placement = placeOn4rLandscape({ width, height }, options.margins, options.dpi);
  const resized = await image
    .resize(placement.width, placement.height, { fit: 'fill', kernel: 'lanczos3' })
    .toColourspace('srgb')
    .toBuffer();
  return finishPage(
    placement,
    [{ input: resized, left: placement.left, top: placement.top }],
    options,
  );
}

/**
 * Calibration chart: a 1 px outline exactly where the photo will land, a center cross, and
 * millimetre ticks measured from the paper edge so a ruler confirms size and border.
 */
export async function renderCalibrationPage(
  options: PrintRenderOptions,
): Promise<RenderedPrintPage> {
  const placement = placementForPage(options);
  const { pageWidth: w, pageHeight: h, left, top, width, height } = placement;
  const mm = options.dpi / 25.4;
  const ticks: string[] = [];
  for (let i = 1; i * mm < Math.min(w, h) / 2; i += 1) {
    const length = i % 10 === 0 ? 6 * mm : i % 5 === 0 ? 4 * mm : 2 * mm;
    const offset = Math.round(i * mm);
    ticks.push(
      `<line x1="${offset}" y1="${h / 2 - length / 2}" x2="${offset}" y2="${h / 2 + length / 2}"/>`,
      `<line x1="${w - offset}" y1="${h / 2 - length / 2}" x2="${w - offset}" y2="${h / 2 + length / 2}"/>`,
      `<line x1="${w / 2 - length / 2}" y1="${offset}" x2="${w / 2 + length / 2}" y2="${offset}"/>`,
      `<line x1="${w / 2 - length / 2}" y1="${h - offset}" x2="${w / 2 + length / 2}" y2="${h - offset}"/>`,
    );
  }
  const stroke = Math.max(1, Math.round(options.dpi / 300));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <g stroke="#000" stroke-width="${stroke}" fill="none" shape-rendering="crispEdges">
      <rect x="${left + stroke / 2}" y="${top + stroke / 2}" width="${width - stroke}" height="${height - stroke}"/>
      <line x1="${w / 2}" y1="${top}" x2="${w / 2}" y2="${top + height}"/>
      <line x1="${left}" y1="${h / 2}" x2="${left + width}" y2="${h / 2}"/>
      ${ticks.join('')}
    </g>
    <g fill="#000">${cornerMarks(left, top, width, height, Math.round(3 * mm))}</g>
  </svg>`;
  return finishPage(placement, [{ input: Buffer.from(svg), left: 0, top: 0 }], options);
}

/** Color test page: primaries, secondaries, an 11-step gray ramp and skin tones. */
export async function renderColorTestPage(options: PrintRenderOptions): Promise<RenderedPrintPage> {
  const placement = placementForPage(options);
  const { left, top, width, height } = placement;
  const swatches = [
    ['#ff0000', '#00ff00', '#0000ff', '#00ffff', '#ff00ff', '#ffff00'],
    ['#8d5524', '#c68642', '#e0ac69', '#f1c27d', '#ffdbac', '#ffe0bd'],
  ];
  const grays = Array.from({ length: 11 }, (_, index) => {
    const value = Math.round((255 * index) / 10)
      .toString(16)
      .padStart(2, '0');
    return `#${value}${value}${value}`;
  });
  const rows = [...swatches, grays];
  const rowHeight = height / rows.length;
  const rects = rows.flatMap((row, rowIndex) => {
    const cellWidth = width / row.length;
    return row.map(
      (color, column) =>
        `<rect x="${left + column * cellWidth}" y="${top + rowIndex * rowHeight}" width="${Math.ceil(cellWidth)}" height="${Math.ceil(rowHeight)}" fill="${color}"/>`,
    );
  });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${placement.pageWidth}" height="${placement.pageHeight}">${rects.join('')}</svg>`;
  return finishPage(placement, [{ input: Buffer.from(svg), left: 0, top: 0 }], options);
}

function placementForPage(options: PrintRenderOptions): PrintPlacement {
  return placeOn4rLandscape({ width: PRINT_4R_ASPECT, height: 1 }, options.margins, options.dpi);
}

function cornerMarks(
  left: number,
  top: number,
  width: number,
  height: number,
  size: number,
): string {
  const right = left + width;
  const bottom = top + height;
  return [
    [left, top],
    [right - size, top],
    [left, bottom - size],
    [right - size, bottom - size],
  ]
    .map(([x, y]) => `<rect x="${x}" y="${y}" width="${size}" height="${Math.max(1, size / 6)}"/>`)
    .join('');
}

async function finishPage(
  placement: PrintPlacement,
  layers: OverlayOptions[],
  options: PrintRenderOptions,
): Promise<RenderedPrintPage> {
  let page = sharp({
    create: {
      width: placement.pageWidth,
      height: placement.pageHeight,
      channels: 3,
      background: WHITE,
    },
  })
    .composite(layers)
    .withMetadata({ density: options.dpi });
  if (options.iccProfilePath) {
    // Converts sRGB to the printer profile and embeds it; the helper draws without further ICM.
    page = page.withIccProfile(options.iccProfilePath);
  }
  const png = await page.png({ compressionLevel: 6 }).toBuffer();
  return { png, placement };
}
