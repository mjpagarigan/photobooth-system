import type { DualDisplayMode } from '@grace-booth/shared';

export type DisplayIdentity = {
  id: number;
};

export type DisplayRoles<TDisplay extends DisplayIdentity> = {
  capture: TDisplay;
  qrStation: TDisplay | null;
};

export function isDualDisplayModeActive(mode: DualDisplayMode, displayCount: number): boolean {
  return mode !== 'disabled' && displayCount >= 2;
}

export function selectDisplayRoles<TDisplay extends DisplayIdentity>(
  displays: readonly TDisplay[],
  primaryDisplay: TDisplay,
  swapDisplays: boolean,
): DisplayRoles<TDisplay> {
  const secondaryDisplay = displays.find((display) => display.id !== primaryDisplay.id) ?? null;
  if (!secondaryDisplay) return { capture: primaryDisplay, qrStation: null };
  return swapDisplays
    ? { capture: secondaryDisplay, qrStation: primaryDisplay }
    : { capture: primaryDisplay, qrStation: secondaryDisplay };
}
