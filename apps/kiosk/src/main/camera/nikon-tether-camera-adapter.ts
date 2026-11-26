import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

import {
  CaptureRequestSchema,
  type CameraAdapter,
  type CameraPreviewFrameEvent,
  type CameraStatus,
  type CaptureRequest,
  type CaptureResult,
} from '@grace-booth/shared';
import { z } from 'zod';

import { AppError } from '../errors.js';

const STATUS_TIMEOUT_MS = 10_000;
const LIVE_VIEW_START_TIMEOUT_MS = 10_000;
const LIVE_VIEW_FRAME_TIMEOUT_MS = 5_000;
const LIVE_VIEW_STOP_TIMEOUT_MS = 5_000;
const PREVIEW_FRAME_INTERVAL_MS = 15;
const MAX_CAPTURE_TIMEOUT_MS = 30_000;

const HelperResponseSchema = z.union([
  z.object({ id: z.number().int(), ok: z.literal(true), data: z.unknown() }),
  z.object({
    id: z.number().int().nullable(),
    ok: z.literal(false),
    code: z.string(),
    message: z.string(),
  }),
]);

const NikonStatusDataSchema = z.object({
  connected: z.boolean(),
  model: z.string().default(''),
  batteryPercent: z.number().int().default(-1),
  imageSize: z.string().default(''),
  message: z.string(),
});

const NikonCaptureDataSchema = z.object({
  path: z.string().min(1),
  bytes: z.number().int().positive(),
  elapsedMs: z.number().nonnegative().optional(),
  model: z.string().optional(),
});

const NikonLiveViewFrameDataSchema = z.union([
  z.object({ skipped: z.literal(true) }),
  z.object({
    skipped: z.literal(false),
    jpegBase64: z.string().min(4),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }),
]);

export type NikonHelperStatus = z.infer<typeof NikonStatusDataSchema>;
export type NikonHelperCapture = z.infer<typeof NikonCaptureDataSchema>;
export type NikonLiveViewFrame = CameraPreviewFrameEvent | { skipped: true };

export type NikonHelperTransport = {
  getStatus(timeoutMs: number): Promise<NikonHelperStatus>;
  capture(outputPath: string, timeoutMs: number): Promise<NikonHelperCapture>;
  startLiveView(timeoutMs: number): Promise<void>;
  getLiveViewFrame(timeoutMs: number): Promise<NikonLiveViewFrame>;
  stopLiveView(timeoutMs: number): Promise<void>;
  abort(error?: Error): void;
  close(): Promise<void>;
};

export type NikonTetherCameraOptions = {
  helperScriptPath?: string;
  tempDirectory?: string;
  platform?: NodeJS.Platform;
  transport?: NikonHelperTransport;
  now?: () => number;
};

class NikonHelperError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

type Pending = {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
};

/**
 * Long-lived PowerShell/WPD bridge to Nikon DSLRs over USB (MTP/PTP).
 * Keeps the compiled C# WPD helper and camera session warm across shots.
 */
class PowerShellNikonTransport implements NikonHelperTransport {
  private child: ChildProcessWithoutNullStreams | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();

  constructor(private readonly helperScriptPath: string) {}

  async getStatus(timeoutMs: number): Promise<NikonHelperStatus> {
    return NikonStatusDataSchema.parse(await this.call('status', {}, timeoutMs));
  }

  async capture(outputPath: string, timeoutMs: number): Promise<NikonHelperCapture> {
    return NikonCaptureDataSchema.parse(
      await this.call('capture', { outputPath, timeoutMs }, timeoutMs + 2_000),
    );
  }

  async startLiveView(timeoutMs: number): Promise<void> {
    await this.call('liveview_start', {}, timeoutMs);
  }

  async getLiveViewFrame(timeoutMs: number): Promise<NikonLiveViewFrame> {
    const parsed = NikonLiveViewFrameDataSchema.parse(
      await this.call('liveview_frame', {}, timeoutMs),
    );
    if (parsed.skipped) return { skipped: true };
    return {
      jpegBase64: parsed.jpegBase64,
      width: parsed.width,
      height: parsed.height,
    };
  }

  async stopLiveView(timeoutMs: number): Promise<void> {
    await this.call('liveview_stop', {}, timeoutMs);
  }

  abort(error?: Error): void {
    const abortError = error ?? new AppError('capture_aborted', 'Capture was cancelled.', true);
    this.restart(abortError);
  }

  close(): Promise<void> {
    const child = this.child;
    if (!child) return Promise.resolve();
    this.child = null;
    try {
      child.stdin.write(`${JSON.stringify({ id: this.nextId++, op: 'disconnect' })}\n`);
      child.stdin.end();
    } catch {
      // ignore write errors during shutdown
    }
    child.kill();
    this.rejectAll(new AppError('camera_disconnected', 'The Nikon USB helper stopped.', true));
    return Promise.resolve();
  }

  private call(op: string, args: Record<string, unknown>, timeoutMs: number): Promise<unknown> {
    const child = this.ensureChild();
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.restart(
          new NikonHelperError('camera_timeout', 'The Nikon camera did not respond in time.'),
        );
        reject(new NikonHelperError('camera_timeout', 'The Nikon camera did not respond in time.'));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      child.stdin.write(`${JSON.stringify({ id, op, ...args })}\n`);
    });
  }

  private ensureChild(): ChildProcessWithoutNullStreams {
    if (this.child) return this.child;
    const child = spawn(
      'powershell.exe',
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        this.helperScriptPath,
      ],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    createInterface({ input: child.stdout }).on('line', (line) => this.handleLine(line));
    child.on('exit', () => {
      if (this.child === child) this.child = null;
      this.rejectAll(
        new NikonHelperError('nikon_helper_exited', 'The Nikon USB camera helper stopped.'),
      );
    });
    child.on('error', () => {
      if (this.child === child) this.child = null;
      this.rejectAll(
        new NikonHelperError('nikon_helper_failed', 'The Nikon USB camera helper could not start.'),
      );
    });
    this.child = child;
    return child;
  }

  private handleLine(line: string): void {
    let parsed: z.infer<typeof HelperResponseSchema>;
    try {
      parsed = HelperResponseSchema.parse(JSON.parse(line));
    } catch {
      return;
    }
    if (parsed.id === null) return;
    const entry = this.pending.get(parsed.id);
    if (!entry) return;
    this.pending.delete(parsed.id);
    clearTimeout(entry.timer);
    if (parsed.ok) entry.resolve(parsed.data);
    else entry.reject(new NikonHelperError(parsed.code, parsed.message));
  }

  private restart(error: Error): void {
    const child = this.child;
    this.child = null;
    try {
      child?.kill();
    } catch {
      // ignore kill error
    }
    this.rejectAll(error);
  }

  private rejectAll(error: Error): void {
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(error);
      this.pending.delete(id);
    }
  }
}

/**
 * Single-cable Nikon DSLR adapter over 8-pin USB (WPD/PTP):
 * - Live countdown and setup preview streams MJPEG frames via Nikon USB Live View (0x9201/0x9203).
 * - Still capture exits Live View cleanly, triggers the real mechanical shutter (0x9207) to SDRAM,
 *   ingests the full-resolution DSLR JPEG directly into memory, and resumes Live View between shots.
 */
export class NikonTetherCameraAdapter implements CameraAdapter {
  private readonly platform: NodeJS.Platform;
  private readonly tempDirectory: string;
  private readonly now: () => number;
  private readonly transport: NikonHelperTransport | null;
  private readonly previewListeners = new Set<(frame: CameraPreviewFrameEvent) => void>();
  private busy = false;
  private previewDesired = false;
  private previewLoopPromise: Promise<void> | null = null;
  private previewControlChain: Promise<void> = Promise.resolve();
  private cancelPreviewSleep: (() => void) | null = null;

  constructor(options: NikonTetherCameraOptions = {}) {
    this.platform = options.platform ?? process.platform;
    this.tempDirectory = options.tempDirectory ?? join(tmpdir(), 'grace-booth-nikon');
    this.now = options.now ?? (() => Date.now());
    this.transport =
      options.transport ??
      (options.helperScriptPath ? new PowerShellNikonTransport(options.helperScriptPath) : null);
  }

  subscribePreviewFrames(listener: (frame: CameraPreviewFrameEvent) => void): () => void {
    this.previewListeners.add(listener);
    return () => {
      this.previewListeners.delete(listener);
    };
  }

  setLivePreviewActive(active: boolean): Promise<void> {
    this.previewDesired = active;
    if (!active) {
      this.cancelPreviewSleep?.();
    }
    const next = this.previewControlChain.then(async () => {
      if (this.platform !== 'win32' || !this.transport) return;
      if (active) {
        if (this.previewDesired && !this.busy) {
          this.startPreviewLoop();
        }
        return;
      }
      await this.previewLoopPromise?.catch(() => undefined);
      if (!this.previewDesired && !this.busy) {
        await this.transport.stopLiveView(LIVE_VIEW_STOP_TIMEOUT_MS).catch(() => undefined);
      }
    });
    this.previewControlChain = next.catch(() => undefined);
    return next;
  }

  private startPreviewLoop(): void {
    if (this.platform !== 'win32' || !this.transport) return;
    if (this.previewLoopPromise || !this.previewDesired || this.busy) return;
    this.previewLoopPromise = this.runPreviewLoop().finally(() => {
      this.previewLoopPromise = null;
    });
  }

  private shouldContinuePreview(): boolean {
    return this.previewDesired && !this.busy;
  }

  private async runPreviewLoop(): Promise<void> {
    const transport = this.transport;
    if (!transport) return;
    try {
      await transport.startLiveView(LIVE_VIEW_START_TIMEOUT_MS);
    } catch {
      return;
    }

    while (this.shouldContinuePreview()) {
      let delayMs = PREVIEW_FRAME_INTERVAL_MS;
      try {
        const result = await transport.getLiveViewFrame(LIVE_VIEW_FRAME_TIMEOUT_MS);
        if (!this.shouldContinuePreview()) break;
        if (!('skipped' in result)) {
          for (const listener of this.previewListeners) {
            listener(result);
          }
        } else {
          delayMs = 40;
        }
      } catch {
        if (!this.shouldContinuePreview()) break;
        delayMs = 250;
      }
      if (!this.shouldContinuePreview()) break;
      await this.sleepPreview(delayMs);
    }
  }

  private sleepPreview(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.cancelPreviewSleep = null;
        resolve();
      }, ms);
      this.cancelPreviewSleep = () => {
        clearTimeout(timer);
        this.cancelPreviewSleep = null;
        resolve();
      };
    });
  }

  async connect(): Promise<CameraStatus> {
    return this.getStatus();
  }

  async getStatus(): Promise<CameraStatus> {
    if (this.platform !== 'win32') {
      return {
        adapter: 'nikon',
        state: 'unsupported',
        code: 'nikon_windows_only',
        operatorMessage: 'Nikon USB tethering is only available on Windows.',
        capabilities: { stillCapture: false, preview: true },
        checkedAt: this.now(),
      };
    }
    if (!this.transport) {
      return {
        adapter: 'nikon',
        state: 'error',
        code: 'nikon_helper_missing',
        operatorMessage: 'The Nikon USB helper script is not configured.',
        capabilities: { stillCapture: false, preview: true },
        checkedAt: this.now(),
      };
    }
    if (this.busy) {
      return {
        adapter: 'nikon',
        state: 'busy',
        code: null,
        operatorMessage: 'Nikon DSLR is capturing a photo over USB.',
        capabilities: { stillCapture: true, preview: true },
        checkedAt: this.now(),
      };
    }
    try {
      const status = await this.transport.getStatus(STATUS_TIMEOUT_MS);
      if (status.connected) {
        return {
          adapter: 'nikon',
          state: 'ready',
          code: null,
          operatorMessage: status.message.slice(0, 300),
          capabilities: { stillCapture: true, preview: true },
          checkedAt: this.now(),
        };
      }
      return {
        adapter: 'nikon',
        state: 'disconnected',
        code: 'nikon_usb_disconnected',
        operatorMessage: status.message.slice(0, 300),
        capabilities: { stillCapture: false, preview: true },
        checkedAt: this.now(),
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Could not communicate with the Nikon USB camera.';
      return {
        adapter: 'nikon',
        state: 'disconnected',
        code: error instanceof NikonHelperError ? error.code.slice(0, 100) : 'nikon_status_failed',
        operatorMessage: message.slice(0, 300),
        capabilities: { stillCapture: false, preview: true },
        checkedAt: this.now(),
      };
    }
  }

  async capture(input: CaptureRequest): Promise<CaptureResult> {
    const request = CaptureRequestSchema.parse(input);
    if (this.platform !== 'win32') {
      throw new AppError(
        'nikon_windows_only',
        'Nikon USB tethering is only available on Windows.',
        false,
      );
    }
    if (!this.transport) {
      throw new AppError(
        'nikon_helper_missing',
        'The Nikon USB helper script is not configured.',
        false,
      );
    }
    if (this.busy) {
      throw new AppError('camera_busy', 'The Nikon camera is busy.', true);
    }
    this.busy = true;
    this.cancelPreviewSleep?.();
    await this.previewLoopPromise?.catch(() => undefined);
    await mkdir(this.tempDirectory, { recursive: true });
    const outputPath = join(this.tempDirectory, `nikon-${request.captureId}.jpg`);
    const timeoutMs = Math.min(MAX_CAPTURE_TIMEOUT_MS, request.timeoutMs);
    try {
      const captured = await this.transport.capture(outputPath, timeoutMs);
      const bytes = await readFile(captured.path);
      return {
        kind: 'buffer',
        captureId: request.captureId,
        bytes,
        contentType: 'image/jpeg',
        capturedAt: this.now(),
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (error instanceof NikonHelperError) {
        throw new AppError(error.code, error.message, true);
      }
      throw new AppError(
        'nikon_capture_failed',
        error instanceof Error ? error.message : 'The Nikon camera could not take the photo.',
        true,
      );
    } finally {
      this.busy = false;
      await rm(outputPath, { force: true }).catch(() => undefined);
      await rm(`${outputPath}.tmp`, { force: true }).catch(() => undefined);
      if (this.previewDesired) {
        this.startPreviewLoop();
      }
    }
  }

  abortCapture(error?: Error): void {
    if (!this.busy) return;
    this.busy = false;
    this.cancelPreviewSleep?.();
    this.transport?.abort(error);
  }

  async disconnect(): Promise<void> {
    this.previewDesired = false;
    this.busy = false;
    this.cancelPreviewSleep?.();
    await this.previewLoopPromise?.catch(() => undefined);
    await this.transport?.stopLiveView(LIVE_VIEW_STOP_TIMEOUT_MS).catch(() => undefined);
    await this.transport?.close();
  }
}
