export const PRODUCTION_STRIP_EXPORT = Object.freeze({
  width: 1_200,
  height: 3_600,
  aspectRatio: 1 / 3,
  jpegQuality: 95,
  chromaSubsampling: '4:4:4' as const,
  mozjpeg: true,
  colourspace: 'srgb' as const,
  densityDpi: 600,
});

export const PRODUCTION_STRIP_JPEG_OPTIONS = Object.freeze({
  quality: PRODUCTION_STRIP_EXPORT.jpegQuality,
  chromaSubsampling: PRODUCTION_STRIP_EXPORT.chromaSubsampling,
  mozjpeg: PRODUCTION_STRIP_EXPORT.mozjpeg,
});

export function hasExactProductionStripAspect(width: number, height: number): boolean {
  return (
    Number.isSafeInteger(width) &&
    Number.isSafeInteger(height) &&
    width > 0 &&
    height > 0 &&
    width * PRODUCTION_STRIP_EXPORT.height === height * PRODUCTION_STRIP_EXPORT.width
  );
}
