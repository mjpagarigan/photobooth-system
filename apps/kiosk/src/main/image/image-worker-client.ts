import { randomUUID } from 'node:crypto';
import { Worker } from 'node:worker_threads';

import type { FrameLayout } from '@grace-booth/shared';

import { AppError } from '../errors.js';
import type { ImagePipelineInput, ImagePipelineResult } from './image-pipeline.js';

const MAX_OUTPUT_EDGE = 12_000;
const MAX_OUTPUT_PIXELS = 80_000_000;

type ProcessedWorkerResult = Pick<ImagePipelineResult, 'byteSize' | 'height' | 'width'> & {
  bytes: Uint8Array;
};

export function validateProcessedWorkerResult(
  result: ProcessedWorkerResult,
  expectedAspectRatio?: number,
): void {
  const dimensionsAreSafe =
    Number.isSafeInteger(result.width) &&
    Number.isSafeInteger(result.height) &&
    result.width > 0 &&
    result.height > 0 &&
    result.width <= MAX_OUTPUT_EDGE &&
    result.height <= MAX_OUTPUT_EDGE &&
    result.width * result.height <= MAX_OUTPUT_PIXELS;
  const aspectMatches =
    expectedAspectRatio === undefined ||
    (Number.isFinite(expectedAspectRatio) &&
      Math.abs(result.width / result.height - expectedAspectRatio) <= 0.000_001);
  if (
    !dimensionsAreSafe ||
    !aspectMatches ||
    result.byteSize !== result.bytes.byteLength ||
    result.byteSize < 1
  ) {
    throw new AppError(
      'image_worker_output',
      'The image processor returned an invalid production photo.',
    );
  }
}

type WorkerResult =
  | ({ kind: 'process' } & Omit<ImagePipelineResult, 'bytes'> & { bytes: Uint8Array })
  | { kind: 'jpeg-validation'; width: number; height: number }
  | { kind: 'normalized-frame'; bytes: Uint8Array; width: number; height: number }
  | { kind: 'thumbnail'; bytes: Uint8Array; width: number; height: number };

type WorkerRequestMessage =
  | {
      id: string;
      operation: 'process';
      captures: Uint8Array[];
      framePng: Uint8Array;
      slots: FrameLayout;
      frameAspectRatio?: number;
    }
  | { id: string; operation: 'validate-source'; bytes: Uint8Array }
  | { id: string; operation: 'normalize-frame'; bytes: Uint8Array }
  | { id: string; operation: 'thumbnail'; bytes: Uint8Array; maxEdge: number };

type PendingRequest = {
  resolve(value: WorkerResult): void;
  reject(error: Error): void;
  timeout: NodeJS.Timeout;
};

type WorkerResponse = {
  id: string;
  ok: boolean;
  result?: WorkerResult;
  error?: { code: string; message: string };
};

export type ImageProcessor = {
  process(input: ImagePipelineInput): Promise<ImagePipelineResult>;
  validateSourceJpeg(bytes: Uint8Array): Promise<{ width: number; height: number }>;
  normalizeFramePng(bytes: Uint8Array): Promise<{ bytes: Buffer; width: number; height: number }>;
  createThumbnail(
    bytes: Uint8Array,
    maxEdge?: number,
  ): Promise<{ bytes: Buffer; width: number; height: number }>;
  close(): Promise<void>;
};

export class WorkerImageProcessor implements ImageProcessor {
  private readonly worker: Worker;
  private readonly pending = new Map<string, PendingRequest>();
  private stopped = false;

  constructor(workerUrl: URL) {
    this.worker = new Worker(workerUrl, { name: 'grace-booth-image-worker' });
    this.worker.on('message', (response: WorkerResponse) => this.handleResponse(response));
    this.worker.on('error', (error) => this.failAll(error));
    this.worker.on('exit', (code) => {
      if (!this.stopped && code !== 0) {
        this.failAll(
          new AppError('image_worker_exit', 'The image processor stopped unexpectedly.', true),
        );
      }
    });
  }

  process(input: ImagePipelineInput): Promise<ImagePipelineResult> {
    if (this.stopped) {
      return Promise.reject(
        new AppError('image_worker_stopped', 'The image processor is unavailable.'),
      );
    }
    const id = randomUUID();
    const captures = input.captures.map((capture) => Uint8Array.from(capture));
    const framePng = Uint8Array.from(input.framePng);
    const message: {
      id: string;
      operation: 'process';
      captures: Uint8Array[];
      framePng: Uint8Array;
      slots: FrameLayout;
      frameAspectRatio?: number;
    } = {
      id,
      operation: 'process',
      captures,
      framePng,
      slots: input.slots,
      ...(input.frameAspectRatio === undefined ? {} : { frameAspectRatio: input.frameAspectRatio }),
    };
    return this.send(message, [...captures.map((capture) => capture.buffer), framePng.buffer]).then(
      (result) => {
        if (result.kind !== 'process') throw new Error('Unexpected image-worker response');
        validateProcessedWorkerResult(result, input.frameAspectRatio);
        return { ...result, bytes: Buffer.from(result.bytes) };
      },
    );
  }

  validateSourceJpeg(bytes: Uint8Array): Promise<{ width: number; height: number }> {
    const id = randomUUID();
    const copy = Uint8Array.from(bytes);
    return this.send({ id, operation: 'validate-source', bytes: copy }, [copy.buffer]).then(
      (result) => {
        if (result.kind !== 'jpeg-validation') throw new Error('Unexpected image-worker response');
        return { width: result.width, height: result.height };
      },
    );
  }

  normalizeFramePng(bytes: Uint8Array): Promise<{ bytes: Buffer; width: number; height: number }> {
    const id = randomUUID();
    const copy = Uint8Array.from(bytes);
    return this.send({ id, operation: 'normalize-frame', bytes: copy }, [copy.buffer]).then(
      (result) => {
        if (result.kind !== 'normalized-frame') throw new Error('Unexpected image-worker response');
        return { bytes: Buffer.from(result.bytes), width: result.width, height: result.height };
      },
    );
  }

  createThumbnail(
    bytes: Uint8Array,
    maxEdge = 360,
  ): Promise<{ bytes: Buffer; width: number; height: number }> {
    const id = randomUUID();
    const copy = Uint8Array.from(bytes);
    return this.send({ id, operation: 'thumbnail', bytes: copy, maxEdge }, [copy.buffer]).then(
      (result) => {
        if (result.kind !== 'thumbnail') throw new Error('Unexpected image-worker response');
        return { bytes: Buffer.from(result.bytes), width: result.width, height: result.height };
      },
    );
  }

  async close(): Promise<void> {
    this.stopped = true;
    this.failAll(new AppError('image_worker_stopped', 'The image processor is closing.'));
    await this.worker.terminate();
  }

  private handleResponse(response: WorkerResponse): void {
    const pending = this.pending.get(response.id);
    if (!pending) return;
    clearTimeout(pending.timeout);
    this.pending.delete(response.id);
    if (!response.ok || !response.result) {
      pending.reject(
        new AppError(
          response.error?.code ?? 'processing_failed',
          response.error?.message ?? 'The collage could not be processed.',
        ),
      );
      return;
    }
    pending.resolve(response.result);
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private send(message: WorkerRequestMessage, transfers: ArrayBuffer[]): Promise<WorkerResult> {
    if (this.stopped) {
      return Promise.reject(
        new AppError('image_worker_stopped', 'The image processor is unavailable.'),
      );
    }
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(message.id);
        reject(new AppError('image_worker_timeout', 'Image work took too long.', true));
      }, 120_000);
      this.pending.set(message.id, { resolve, reject, timeout });
      this.worker.postMessage(message, transfers);
    });
  }
}
