import { describe, expect, it } from 'vitest';

import { loadRuntimeConfig } from '../../src/main/config.js';

describe('runtime capture configuration', () => {
  it('leaves captureOverride null in production so persisted settings control capture timing and mode', () => {
    expect(loadRuntimeConfig({}, false).captureOverride).toBeNull();
    expect(
      loadRuntimeConfig({ GRACE_BOOTH_E2E_COUNTDOWN_MS: '5000' }, false).captureOverride,
    ).toBeNull();
  });

  it('defaults E2E mode to 40ms countdown while respecting persisted review mode', () => {
    const config = loadRuntimeConfig({ GRACE_BOOTH_E2E: '1' }, false);
    expect(config.captureOverride).toEqual({ countdownMs: 40, reviewMode: null });
  });

  it('supports explicit E2E countdown durations, settings passthrough, review mode overrides, and 1..10 fail shots', () => {
    expect(
      loadRuntimeConfig({ GRACE_BOOTH_E2E: '1', GRACE_BOOTH_E2E_COUNTDOWN_MS: '5000' }, false)
        .captureOverride,
    ).toEqual({ countdownMs: 5_000, reviewMode: null });

    expect(
      loadRuntimeConfig({ GRACE_BOOTH_E2E: '1', GRACE_BOOTH_E2E_COUNTDOWN_MS: '30000' }, false)
        .captureOverride,
    ).toEqual({ countdownMs: 30_000, reviewMode: null });

    expect(
      loadRuntimeConfig(
        {
          GRACE_BOOTH_E2E: '1',
          GRACE_BOOTH_E2E_COUNTDOWN_MS: 'settings',
          GRACE_BOOTH_E2E_REVIEW_MODE: 'continuous',
        },
        false,
      ).captureOverride,
    ).toEqual({ countdownMs: null, reviewMode: 'continuous' });

    expect(
      loadRuntimeConfig({ GRACE_BOOTH_E2E: '1', GRACE_BOOTH_E2E_CAPTURE_FAIL_SHOT: '10' }, false)
        .e2e.captureFailShot,
    ).toBe(10);

    expect(() =>
      loadRuntimeConfig({ GRACE_BOOTH_E2E: '1', GRACE_BOOTH_E2E_COUNTDOWN_MS: '9' }, false),
    ).toThrow();
    expect(() =>
      loadRuntimeConfig({ GRACE_BOOTH_E2E: '1', GRACE_BOOTH_E2E_COUNTDOWN_MS: '30001' }, false),
    ).toThrow();
    expect(() =>
      loadRuntimeConfig({ GRACE_BOOTH_E2E: '1', GRACE_BOOTH_E2E_REVIEW_MODE: 'manual' }, false),
    ).toThrow();
    expect(() =>
      loadRuntimeConfig({ GRACE_BOOTH_E2E: '1', GRACE_BOOTH_E2E_CAPTURE_FAIL_SHOT: '11' }, false),
    ).toThrow();
  });
});
