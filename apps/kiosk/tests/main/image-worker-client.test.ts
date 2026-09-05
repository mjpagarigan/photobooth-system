import { describe, expect, it } from 'vitest';

import { validateProcessedWorkerResult } from '../../src/main/image/image-worker-client.js';

describe('image worker result validation', () => {
  it('accepts a valid 16:9 result instead of requiring the legacy 1200x3600 strip', () => {
    expect(() =>
      validateProcessedWorkerResult(
        { width: 1920, height: 1080, byteSize: 4, bytes: new Uint8Array([1, 2, 3, 4]) },
        16 / 9,
      ),
    ).not.toThrow();
  });

  it('rejects malformed or aspect-mismatched worker results', () => {
    expect(() =>
      validateProcessedWorkerResult(
        { width: 1200, height: 3600, byteSize: 4, bytes: new Uint8Array([1, 2, 3, 4]) },
        16 / 9,
      ),
    ).toThrow(/invalid production photo/i);
  });
});
