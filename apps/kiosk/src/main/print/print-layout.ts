import { PAPER_4R_HUNDREDTHS, type PaperCandidate, type PaperMargins } from '@grace-booth/shared';

/** Used when a driver reports no usable resolution. Dye-sub photo printers are 300 DPI. */
export const FALLBACK_PRINT_DPI = 300;
/** Above this the bitmap only grows the spool file; no photo printer resolves finer at 4R. */
export const MAX_PRINT_DPI = 600;

export function is4rPaper(
  paper: Pick<PaperCandidate, 'widthHundredths' | 'heightHundredths'>,
): boolean {
  const short = Math.min(paper.widthHundredths, paper.heightHundredths);
  const long = Math.max(paper.widthHundredths, paper.heightHundredths);
  // Drivers round 4×6 in to 400×600 hundredths; allow ±2 for metric-defined sizes.
  return (
    Math.abs(short - PAPER_4R_HUNDREDTHS.shortEdge) <= 2 &&
    Math.abs(long - PAPER_4R_HUNDREDTHS.longEdge) <= 2
  );
}

/**
 * Picks the driver's 4×6 paper. Drivers name the same size differently, so the match is by
 * physical size; a bordered variant is preferred over one labelled borderless.
 */
export function choose4rPaper(candidates: readonly PaperCandidate[]): PaperCandidate | null {
  const fourR = candidates.filter(is4rPaper);
  return fourR.find((paper) => !/borderless/i.test(paper.name)) ?? fourR[0] ?? null;
}

export function printDpi(reported: number | null): number {
  if (reported === null || !Number.isFinite(reported) || reported < 150) return FALLBACK_PRINT_DPI;
  return Math.min(Math.round(reported), MAX_PRINT_DPI);
}

export type PrintPlacement = {
  /** Full landscape page in pixels. */
  pageWidth: number;
  pageHeight: number;
  /** Where the photo goes on that page, in pixels. */
  left: number;
  top: number;
  width: number;
  height: number;
};

/**
 * Decision A: the whole photo fits inside the printable area, centered, never cropped.
 *
 * Margins arrive in portrait paper coordinates. On a landscape page the portrait top/bottom
 * become the left/right edges and vice versa. Each axis uses its larger margin on both sides so
 * an asymmetric driver margin never shows as a lopsided border.
 */
export function placeOn4rLandscape(
  photo: { width: number; height: number },
  margins: PaperMargins | null,
  dpi: number,
): PrintPlacement {
  const pageWidth = Math.round((PAPER_4R_HUNDREDTHS.longEdge / 100) * dpi);
  const pageHeight = Math.round((PAPER_4R_HUNDREDTHS.shortEdge / 100) * dpi);
  const insetX = Math.ceil((Math.max(margins?.top ?? 0, margins?.bottom ?? 0) / 100) * dpi);
  const insetY = Math.ceil((Math.max(margins?.left ?? 0, margins?.right ?? 0) / 100) * dpi);
  const boxWidth = Math.max(1, pageWidth - 2 * insetX);
  const boxHeight = Math.max(1, pageHeight - 2 * insetY);
  const scale = Math.min(boxWidth / photo.width, boxHeight / photo.height);
  const width = Math.max(1, Math.floor(photo.width * scale));
  const height = Math.max(1, Math.floor(photo.height * scale));
  return {
    pageWidth,
    pageHeight,
    left: Math.floor((pageWidth - width) / 2),
    top: Math.floor((pageHeight - height) / 2),
    width,
    height,
  };
}
