import {
  CaptureRequestSchema,
  type CameraAdapter,
  type CameraStatus,
  type CaptureRequest,
  type CaptureResult,
} from '@grace-booth/shared';

import { AppError } from '../errors.js';
import type { RendererFrameBroker } from './renderer-frame-broker.js';

const MAX_FRAME_WAIT_MS = 15_000;

export type WebcamCameraOptions = {
  frameTimeoutMs?: number;
};

/**
 * Captures from the laptop or system webcam. The device itself is owned by the trusted renderer,
 * which is the only process with a media stream; main keeps authority over when a photo is taken,
 * how long it may take, and whether the returned bytes are acceptable.
 */
export class WebcamCameraAdapter implements CameraAdapter {
  private connected = false;
  private busy = false;

  constructor(
    private readonly broker: RendererFrameBroker,
    private readonly options: WebcamCameraOptions = {},
  ) {}

  connect(): Promise<CameraStatus> {
    this.connected = true;
    return this.getStatus();
  }

  getStatus(): Promise<CameraStatus> {
    const attached = this.broker.isAttached();
    const state = !this.connected || !attached ? 'disconnected' : this.busy ? 'busy' : 'ready';
    return Promise.resolve({
      adapter: 'webcam',
      state,
      code: state === 'disconnected' ? 'webcam_renderer_unavailable' : null,
      operatorMessage:
        state === 'disconnected'
          ? 'The laptop camera is not ready. Check that the booth display is running and that camera access is allowed.'
          : 'The laptop camera is ready.',
      capabilities: { stillCapture: true, preview: true },
      checkedAt: Date.now(),
    });
  }

  async capture(input: CaptureRequest): Promise<CaptureResult> {
    const request = CaptureRequestSchema.parse(input);
    if (!this.connected || !this.broker.isAttached()) {
      throw new AppError('camera_disconnected', 'The camera is not connected.', true);
    }
    if (this.busy) throw new AppError('camera_busy', 'The camera is busy.', true);
    this.busy = true;
    try {
      const timeoutMs = Math.min(
        this.options.frameTimeoutMs ?? MAX_FRAME_WAIT_MS,
        request.timeoutMs,
      );
      const bytes = await this.broker.requestFrame(request.captureId, timeoutMs);
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

  abortCapture(error?: Error): void {
    this.busy = false;
    this.broker.abortPending(error);
  }

  disconnect(): Promise<void> {
    this.connected = false;
    this.abortCapture();
    return Promise.resolve();
  }
}
