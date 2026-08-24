import { describe, expect, it } from 'vitest';

import { loadRuntimeConfig } from '../../src/main/config.js';

describe('runtime capture timing', () => {
  it('uses the per-shot production schedule with a longer opening countdown', () => {
    expect(loadRuntimeConfig({}, false).shotCountdownsMs).toEqual([8_000, 5_000, 5_000]);
  });

  it('collapses every shot to the accelerated test countdown override', () => {
    const config = loadRuntimeConfig(
      { GRACE_BOOTH_E2E: '1', GRACE_BOOTH_E2E_COUNTDOWN_MS: '5000' },
      false,
    );
    expect(config.shotCountdownsMs).toEqual([5_000, 5_000, 5_000]);
    expect(config.shotCountdownsMs[0]).toBe(5_000);
    expect(() =>
      loadRuntimeConfig({ GRACE_BOOTH_E2E: '1', GRACE_BOOTH_E2E_COUNTDOWN_MS: '5001' }, false),
    ).toThrow();
    expect(() =>
      loadRuntimeConfig({ GRACE_BOOTH_E2E: '1', GRACE_BOOTH_E2E_CAPTURE_FAIL_SHOT: '4' }, false),
    ).toThrow();
  });
});
