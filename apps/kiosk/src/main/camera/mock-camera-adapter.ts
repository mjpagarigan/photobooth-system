import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  CaptureRequestSchema,
  type CameraAdapter,
  type CameraStatus,
  type CaptureRequest,
  type CaptureResult,
} from '@grace-booth/shared';
import { AppError } from '../errors.js';

export type MockCameraOptions = {
  fixtureDirectory: string;
  delayMs?: number;
  failOnShotNumbers?: ReadonlySet<number>;
};

export class MockCameraAdapter implements CameraAdapter {
  private connected = false;
  private busy = false;

  constructor(private readonly options: MockCameraOptions) {}

  async connect(): Promise<CameraStatus> {
    this.connected = true;
    return this.getStatus();
  }

  getStatus(): Promise<CameraStatus> {
    const state = this.busy ? 'busy' : this.connected ? 'ready' : 'disconnected';
    return Promise.resolve({
      adapter: 'mock',
      state,
      code: null,
      operatorMessage: this.connected ? 'Mock camera is ready.' : 'Mock camera is disconnected.',
      capabilities: { stillCapture: true, preview: false },
      checkedAt: Date.now(),
    });
  }

  async capture(input: CaptureRequest): Promise<CaptureResult> {
    const request = CaptureRequestSchema.parse(input);
    if (!this.connected)
      throw new AppError('camera_disconnected', 'The camera is not connected.', true);
    if (this.busy) throw new AppError('camera_busy', 'The camera is busy.', true);
    this.busy = true;
    try {
      await delay(Math.min(this.options.delayMs ?? 300, request.timeoutMs));
      if (this.options.failOnShotNumbers?.has(request.shotNumber)) {
        throw new AppError('mock_capture_failure', 'The camera could not take that photo.', true);
      }
      const fixtureIndex = ((request.shotNumber - 1) % 4) + 1;
      const bytes = await readFile(
        join(this.options.fixtureDirectory, `photo-${fixtureIndex}.jpg`),
      );
      if (bytes.byteLength < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
        throw new AppError('mock_fixture_invalid', 'A mock camera fixture is not a valid JPEG.');
      }
      return {
        kind: 'buffer',
        captureId: request.captureId,
        bytes,
        contentType: 'image/jpeg',
        capturedAt: Date.now(),
      };
    } finally {
      this.busy = false;
    }
  }

  disconnect(): Promise<void> {
    this.connected = false;
    return Promise.resolve();
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
