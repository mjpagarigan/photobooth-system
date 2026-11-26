import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  NikonTetherCameraAdapter,
  type NikonHelperCapture,
  type NikonHelperTransport,
} from '../../src/main/camera/nikon-tether-camera-adapter.js';

const FAKE_JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0xff, 0xd9,
]);

const createdDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'grace-booth-nikon-test-'));
  createdDirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (createdDirs.length > 0) {
    const dir = createdDirs.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

function createTransport(overrides: Partial<NikonHelperTransport> = {}): NikonHelperTransport {
  return {
    getStatus: vi.fn(() =>
      Promise.resolve({
        connected: true,
        model: 'D5200',
        batteryPercent: 100,
        imageSize: '6000x4000',
        message: 'Nikon D5200 is ready on USB (6000x4000, 100% battery).',
      }),
    ),
    capture: vi.fn(async (outputPath: string) => {
      await writeFile(outputPath, FAKE_JPEG);
      return {
        path: outputPath,
        bytes: FAKE_JPEG.byteLength,
        elapsedMs: 1_500,
        model: 'D5200',
      };
    }),
    startLiveView: vi.fn(() => Promise.resolve()),
    getLiveViewFrame: vi.fn(() =>
      Promise.resolve({
        jpegBase64: FAKE_JPEG.toString('base64'),
        width: 640,
        height: 424,
      }),
    ),
    stopLiveView: vi.fn(() => Promise.resolve()),
    abort: vi.fn(),
    close: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
}

describe('NikonTetherCameraAdapter', () => {
  it('reports ready status when the Nikon camera is connected over USB', async () => {
    const transport = createTransport();
    const adapter = new NikonTetherCameraAdapter({
      platform: 'win32',
      transport,
      now: () => 1234,
    });

    const status = await adapter.connect();
    expect(status).toEqual({
      adapter: 'nikon',
      state: 'ready',
      code: null,
      operatorMessage: 'Nikon D5200 is ready on USB (6000x4000, 100% battery).',
      capabilities: { stillCapture: true, preview: true },
      checkedAt: 1234,
    });
  });

  it('reports disconnected when no Nikon camera is detected', async () => {
    const transport = createTransport({
      getStatus: vi.fn(() =>
        Promise.resolve({
          connected: false,
          model: '',
          batteryPercent: -1,
          imageSize: '',
          message: 'No Nikon camera was found on USB.',
        }),
      ),
    });
    const adapter = new NikonTetherCameraAdapter({ platform: 'win32', transport });

    const status = await adapter.getStatus();
    expect(status.state).toBe('disconnected');
    expect(status.code).toBe('nikon_usb_disconnected');
    expect(status.capabilities).toEqual({ stillCapture: false, preview: true });
  });

  it('reports unsupported on non-Windows platforms', async () => {
    const adapter = new NikonTetherCameraAdapter({
      platform: 'darwin',
      transport: createTransport(),
    });

    const status = await adapter.getStatus();
    expect(status.state).toBe('unsupported');
    expect(status.code).toBe('nikon_windows_only');
  });

  it('captures a JPEG buffer and removes the temporary file from disk', async () => {
    const tempDirectory = await makeTempDir();
    let writtenPath = '';
    const transport = createTransport({
      capture: vi.fn(async (outputPath: string) => {
        writtenPath = outputPath;
        await writeFile(outputPath, FAKE_JPEG);
        return { path: outputPath, bytes: FAKE_JPEG.byteLength, elapsedMs: 1_200, model: 'D5200' };
      }),
    });
    const adapter = new NikonTetherCameraAdapter({
      platform: 'win32',
      tempDirectory,
      transport,
      now: () => 5678,
    });

    const captureId = randomUUID();
    const result = await adapter.capture({
      sessionId: randomUUID(),
      captureId,
      shotNumber: 1,
      timeoutMs: 15_000,
    });

    expect(result.kind).toBe('buffer');
    if (result.kind === 'buffer') {
      expect(Buffer.from(result.bytes).equals(FAKE_JPEG)).toBe(true);
      expect(result.captureId).toBe(captureId);
      expect(result.capturedAt).toBe(5678);
    }
    expect(writtenPath).not.toBe('');
    expect(existsSync(writtenPath)).toBe(false);
  });

  it('rejects overlapping captures while busy and clears busy state on abort', async () => {
    const tempDirectory = await makeTempDir();
    let rejectCapture: ((err: Error) => void) | null = null;
    const captureMock = vi.fn(
      () =>
        new Promise<NikonHelperCapture>((_resolve, reject) => {
          rejectCapture = reject;
        }),
    );
    const abortMock = vi.fn((error?: Error) => {
      rejectCapture?.(error ?? new Error('aborted'));
    });
    const transport = createTransport({
      capture: captureMock,
      abort: abortMock,
    });
    const adapter = new NikonTetherCameraAdapter({
      platform: 'win32',
      tempDirectory,
      transport,
    });

    const sessionId = randomUUID();
    const first = adapter.capture({
      sessionId,
      captureId: randomUUID(),
      shotNumber: 1,
      timeoutMs: 15_000,
    });

    await vi.waitFor(() => expect(captureMock).toHaveBeenCalledOnce());
    const busyStatus = await adapter.getStatus();
    expect(busyStatus.state).toBe('busy');

    await expect(
      adapter.capture({
        sessionId,
        captureId: randomUUID(),
        shotNumber: 2,
        timeoutMs: 15_000,
      }),
    ).rejects.toThrow(/busy/i);

    adapter.abortCapture();
    await expect(first).rejects.toThrow(/aborted|cancelled/i);
    expect(abortMock).toHaveBeenCalledOnce();
  });

  it('streams USB Live View frames, pauses cleanly for capture, resumes after, and stops Live View', async () => {
    const tempDirectory = await makeTempDir();
    let captureInProgress = false;
    let overlappedWithCapture = false;
    const startLiveView = vi.fn(() => Promise.resolve());
    const stopLiveView = vi.fn(() => Promise.resolve());
    const getLiveViewFrame = vi.fn(() => {
      if (captureInProgress) overlappedWithCapture = true;
      return Promise.resolve({
        jpegBase64: FAKE_JPEG.toString('base64'),
        width: 640,
        height: 424,
      });
    });
    const captureMock = vi.fn(async (outputPath: string) => {
      captureInProgress = true;
      await new Promise((resolve) => setTimeout(resolve, 30));
      await writeFile(outputPath, FAKE_JPEG);
      captureInProgress = false;
      return { path: outputPath, bytes: FAKE_JPEG.byteLength, elapsedMs: 1_200, model: 'D5200' };
    });

    const transport = createTransport({
      startLiveView,
      getLiveViewFrame,
      stopLiveView,
      capture: captureMock,
    });
    const adapter = new NikonTetherCameraAdapter({
      platform: 'win32',
      tempDirectory,
      transport,
    });

    const frames: { width: number; height: number }[] = [];
    const unsubscribe = adapter.subscribePreviewFrames((frame) => {
      frames.push({ width: frame.width, height: frame.height });
    });

    await adapter.setLivePreviewActive(true);
    await vi.waitFor(() => expect(frames.length).toBeGreaterThanOrEqual(2));
    expect(startLiveView).toHaveBeenCalledOnce();
    expect(frames[0]).toEqual({ width: 640, height: 424 });

    const countBeforeCapture = frames.length;
    await adapter.capture({
      sessionId: randomUUID(),
      captureId: randomUUID(),
      shotNumber: 1,
      timeoutMs: 15_000,
    });
    expect(overlappedWithCapture).toBe(false);

    await vi.waitFor(() => expect(frames.length).toBeGreaterThan(countBeforeCapture));

    await adapter.setLivePreviewActive(false);
    expect(stopLiveView).toHaveBeenCalled();

    unsubscribe();
    await adapter.disconnect();
  });
});
