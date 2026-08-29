import { describe, expect, it } from 'vitest';

import {
  isDualDisplayModeActive,
  selectDisplayRoles,
} from '../../src/main/security/dual-display-policy.js';

describe('dual display policy', () => {
  it('activates auto mode only when an extended display is present', () => {
    expect(isDualDisplayModeActive('auto', 1)).toBe(false);
    expect(isDualDisplayModeActive('auto', 2)).toBe(true);
    expect(isDualDisplayModeActive('enabled', 2)).toBe(true);
    expect(isDualDisplayModeActive('disabled', 2)).toBe(false);
  });

  it('keeps capture on primary and QR delivery on secondary unless swapped', () => {
    const primary = { id: 1, label: 'primary' };
    const secondary = { id: 2, label: 'secondary' };
    const displays = [secondary, primary];

    expect(selectDisplayRoles(displays, primary, false)).toEqual({
      capture: primary,
      qrStation: secondary,
    });
    expect(selectDisplayRoles(displays, primary, true)).toEqual({
      capture: secondary,
      qrStation: primary,
    });
  });
});
