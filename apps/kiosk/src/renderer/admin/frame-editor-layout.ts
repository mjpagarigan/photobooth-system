export type FittedFrameSize = {
  height: number;
  width: number;
};

export function fitFrameWithin(
  availableWidth: number,
  availableHeight: number,
  frameWidth: number,
  frameHeight: number,
): FittedFrameSize {
  if (availableWidth <= 0 || availableHeight <= 0 || frameWidth <= 0 || frameHeight <= 0) {
    return { width: 0, height: 0 };
  }
  const frameAspect = frameWidth / frameHeight;
  return availableWidth / availableHeight > frameAspect
    ? { width: availableHeight * frameAspect, height: availableHeight }
    : { width: availableWidth, height: availableWidth / frameAspect };
}
