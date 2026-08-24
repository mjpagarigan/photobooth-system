import type {
  CameraAdapter,
  CameraAdapterKind,
  CameraStatus,
  CaptureRequest,
  CaptureResult,
} from '@grace-booth/shared';

import { MockCameraAdapter, type MockCameraOptions } from './mock-camera-adapter.js';
import type { RendererFrameBroker } from './renderer-frame-broker.js';
import { SonyCameraAdapter } from './sony-camera-adapter.js';
import { WebcamCameraAdapter } from './webcam-camera-adapter.js';

export type DynamicCameraOptions = {
  mockOptions: MockCameraOptions;
  frameBroker: RendererFrameBroker;
  initialAdapter?: CameraAdapterKind;
  initialDeviceId?: string | null;
  onAdapterChanged?: (adapter: CameraAdapterKind, deviceId: string | null) => void;
};

export class DynamicCameraAdapter implements CameraAdapter {
  private readonly mockAdapter: MockCameraAdapter;
  private readonly sonyAdapter: SonyCameraAdapter;
  private readonly webcamAdapter: WebcamCameraAdapter;
  private activeKind: CameraAdapterKind;
  private deviceId: string | null;

  constructor(private readonly options: DynamicCameraOptions) {
    this.mockAdapter = new MockCameraAdapter(options.mockOptions);
    this.sonyAdapter = new SonyCameraAdapter();
    this.webcamAdapter = new WebcamCameraAdapter(options.frameBroker);
    this.activeKind = options.initialAdapter ?? 'webcam';
    this.deviceId = options.initialDeviceId ?? null;
  }

  getActiveAdapterKind(): CameraAdapterKind {
    return this.activeKind;
  }

  getDeviceId(): string | null {
    return this.deviceId;
  }

  async switchAdapter(
    adapterKind: CameraAdapterKind,
    deviceId: string | null = null,
  ): Promise<CameraStatus> {
    const previous = this.getActiveAdapter();
    await previous.disconnect().catch(() => undefined);
    this.activeKind = adapterKind;
    this.deviceId = deviceId;
    const current = this.getActiveAdapter();
    const status = await current.connect();
    this.options.onAdapterChanged?.(this.activeKind, this.deviceId);
    return status;
  }

  async connect(): Promise<CameraStatus> {
    return this.getActiveAdapter().connect();
  }

  async getStatus(): Promise<CameraStatus> {
    const status = await this.getActiveAdapter().getStatus();
    return {
      ...status,
      adapter: this.activeKind,
    };
  }

  async capture(request: CaptureRequest): Promise<CaptureResult> {
    return this.getActiveAdapter().capture(request);
  }

  abortCapture(error?: Error): void {
    this.webcamAdapter.abortCapture(error);
  }

  async disconnect(): Promise<void> {
    await Promise.allSettled([
      this.mockAdapter.disconnect(),
      this.sonyAdapter.disconnect(),
      this.webcamAdapter.disconnect(),
    ]);
  }

  private getActiveAdapter(): CameraAdapter {
    switch (this.activeKind) {
      case 'sony':
        return this.sonyAdapter;
      case 'mock':
        return this.mockAdapter;
      case 'internal_webcam':
      case 'webcam':
      default:
        return this.webcamAdapter;
    }
  }
}
