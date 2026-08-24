import type { CameraFrameRequestEvent } from '@grace-booth/shared';

import { AppError } from '../errors.js';

const JPEG_MAGIC = [0xff, 0xd8, 0xff] as const;
const MAX_FRAME_BYTES = 20 * 1024 * 1024;

export type CameraFrameRequestSender = (request: CameraFrameRequestEvent) => void;

type PendingFrame = {
  captureId: string;
  resolve: (bytes: Buffer) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

/**
 * Bridges a main-process capture request to the single trusted renderer that owns the webcam
 * stream. Exactly one request may be outstanding, and a frame is only accepted for the capture id
 * that main itself issued.
 */
export class RendererFrameBroker {
  private sender: CameraFrameRequestSender | null = null;
  private pending: PendingFrame | null = null;

  attach(sender: CameraFrameRequestSender): void {
    this.sender = sender;
  }

  detach(): void {
    this.sender = null;
    this.settleWithError(
      new AppError('camera_disconnected', 'The booth display is not ready for photos.', true),
    );
  }

  isAttached(): boolean {
    return this.sender !== null;
  }

  requestFrame(captureId: string, timeoutMs: number): Promise<Buffer> {
    const sender = this.sender;
    if (!sender) {
      return Promise.reject(
        new AppError('camera_disconnected', 'The booth display is not ready for photos.', true),
      );
    }
    if (this.pending) {
      return Promise.reject(new AppError('camera_busy', 'The camera is busy.', true));
    }
    return new Promise<Buffer>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending = null;
        reject(new AppError('camera_timeout', 'The camera did not respond in time.', true));
      }, timeoutMs);
      timer.unref();
      this.pending = { captureId, resolve, reject, timer };
      try {
        sender({ captureId, deadlineAt: Date.now() + timeoutMs });
      } catch {
        clearTimeout(timer);
        this.pending = null;
        reject(new AppError('camera_unavailable', 'The camera could not be reached.', true));
      }
    });
  }

  submitFrame(captureId: string, bytes: Uint8Array): void {
    const pending = this.pending;
    if (pending?.captureId !== captureId) {
      throw new AppError('capture_not_requested', 'No photo was requested.');
    }
    assertJpeg(bytes);
    clearTimeout(pending.timer);
    this.pending = null;
    pending.resolve(Buffer.from(bytes));
  }

  abortPending(
    error: Error = new AppError('capture_cancelled', 'Photo capture was cancelled.', true),
  ): void {
    this.settleWithError(error);
  }

  private settleWithError(error: Error): void {
    const pending = this.pending;
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending = null;
    pending.reject(error);
  }
}

function assertJpeg(bytes: Uint8Array): void {
  if (bytes.byteLength < 4 || bytes.byteLength > MAX_FRAME_BYTES) {
    throw new AppError('capture_size', 'The camera photo is outside the safe size limit.');
  }
  if (JPEG_MAGIC.some((value, index) => bytes[index] !== value)) {
    throw new AppError('capture_signature', 'The camera photo is not a valid JPEG.');
  }
}
