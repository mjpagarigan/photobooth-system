import { parentPort } from 'node:worker_threads';

import type { FrameLayout } from '@grace-booth/shared';

import { AppError } from '../errors.js';
import { FaceAwareWithCenterFallback, MediaPipeCropStrategy } from './crop-strategy.js';
import { ImagePipeline } from './image-pipeline.js';
import { createThumbnailJpeg, normalizeFramePng, validateSourceJpeg } from './image-validation.js';

type ProcessRequest = {
  id: string;
  operation: 'process';
  captures: [Uint8Array, Uint8Array, Uint8Array];
  framePng: Uint8Array;
  slots: FrameLayout;
  frameAspectRatio?: number;
};

type SourceValidationRequest = {
  id: string;
  operation: 'validate-source';
  bytes: Uint8Array;
};

type FrameNormalizationRequest = {
  id: string;
  operation: 'normalize-frame';
  bytes: Uint8Array;
};

type ThumbnailRequest = {
  id: string;
  operation: 'thumbnail';
  bytes: Uint8Array;
  maxEdge: number;
};

type WorkerRequest =
  | ProcessRequest
  | SourceValidationRequest
  | FrameNormalizationRequest
  | ThumbnailRequest;

type WorkerSuccess = {
  id: string;
  ok: true;
  result: object;
};

type WorkerFailure = {
  id: string;
  ok: false;
  error: { code: string; message: string };
};

if (!parentPort) throw new Error('Image worker must run in a worker thread');

const pipeline = new ImagePipeline(new FaceAwareWithCenterFallback(new MediaPipeCropStrategy()));

parentPort.on('message', (request: WorkerRequest) => {
  void processRequest(request);
});

async function processRequest(request: WorkerRequest): Promise<void> {
  try {
    if (request.operation === 'validate-source') {
      const result = await validateSourceJpeg(request.bytes);
      parentPort?.postMessage({
        id: request.id,
        ok: true,
        result: { kind: 'jpeg-validation', ...result },
      } satisfies WorkerSuccess);
      return;
    }
    if (request.operation === 'normalize-frame') {
      const result = await normalizeFramePng(request.bytes);
      parentPort?.postMessage(
        {
          id: request.id,
          ok: true,
          result: { kind: 'normalized-frame', ...result },
        } satisfies WorkerSuccess,
        [result.bytes.buffer as ArrayBuffer],
      );
      return;
    }
    if (request.operation === 'thumbnail') {
      const result = await createThumbnailJpeg(request.bytes, request.maxEdge);
      parentPort?.postMessage(
        {
          id: request.id,
          ok: true,
          result: { kind: 'thumbnail', ...result },
        } satisfies WorkerSuccess,
        [result.bytes.buffer as ArrayBuffer],
      );
      return;
    }
    const result = await pipeline.process(request);
    const response: WorkerSuccess = {
      id: request.id,
      ok: true,
      result: { kind: 'process', ...result, bytes: result.bytes },
    };
    parentPort?.postMessage(response, [result.bytes.buffer as ArrayBuffer]);
  } catch (error) {
    const response: WorkerFailure = {
      id: request.id,
      ok: false,
      error: {
        code: error instanceof Error && 'code' in error ? String(error.code) : 'processing_failed',
        message:
          error instanceof AppError
            ? error.safeMessage
            : 'The image could not be processed safely.',
      },
    };
    parentPort?.postMessage(response);
  }
}
