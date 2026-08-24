import {
  CAMERA_RESOLUTION_DIMENSIONS,
  type CameraDevice,
  type CameraResolution,
} from '@grace-booth/shared';
import { useCallback, useEffect, useRef, useState } from 'react';

const CAPTURE_QUALITY = 0.92;
const ACQUISITION_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = 400;

export type CameraAcquisitionState =
  | 'disabled'
  | 'initializing'
  | 'ready'
  | 'permission-denied'
  | 'unavailable';

export type NegotiatedCameraResolution = {
  width: number;
  height: number;
};

export type CameraStreamState = {
  stream: MediaStream | null;
  acquisitionState: CameraAcquisitionState;
  resolution: NegotiatedCameraResolution | null;
  error: 'permission-denied' | 'unavailable' | null;
};

export type CameraStream = CameraStreamState & {
  ready: boolean;
  denied: boolean;
  videoRef: (element: HTMLVideoElement | null) => void;
  grabJpegBase64: () => string | null;
};

export async function enumerateVideoDevices(): Promise<CameraDevice[]> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter((device) => device.kind === 'videoinput')
      .map((device, index) => ({
        deviceId: device.deviceId,
        label: device.label.length > 0 ? device.label : `Camera ${index + 1}`,
        groupId: device.groupId,
      }));
  } catch {
    return [];
  }
}

function candidateConstraints(
  deviceId: string | null | undefined,
  devices: CameraDevice[],
  requestedResolution: CameraResolution,
): MediaTrackConstraints {
  const dimensions = CAMERA_RESOLUTION_DIMENSIONS[requestedResolution];
  const base: MediaTrackConstraints = {
    width: { ideal: dimensions.width },
    height: { ideal: dimensions.height },
  };
  if (deviceId) return { ...base, deviceId: { exact: deviceId } };
  const firstAvailable = devices[0]?.deviceId;
  if (firstAvailable) return { ...base, deviceId: { exact: firstAvailable } };
  return { ...base, facingMode: 'user' };
}

function negotiatedResolution(width: unknown, height: unknown): NegotiatedCameraResolution | null {
  if (
    typeof width !== 'number' ||
    typeof height !== 'number' ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return null;
  }
  return { width: Math.round(width), height: Math.round(height) };
}

function permissionWasDenied(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === 'NotAllowedError' || error.name === 'SecurityError')
  );
}

/** Owns the renderer webcam stream used for settings preview and guest captures. */
export function useCameraStream(
  enabled: boolean,
  deviceId?: string | null,
  requestedResolution: CameraResolution = '1080p',
): CameraStream {
  const [state, setState] = useState<CameraStreamState>({
    stream: null,
    acquisitionState: 'disabled',
    resolution: null,
    error: null,
  });
  const videoElementRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const mediaDevices: MediaDevices | undefined =
      typeof navigator === 'undefined' ? undefined : navigator.mediaDevices;
    if (!enabled) {
      setState({ stream: null, acquisitionState: 'disabled', resolution: null, error: null });
      return;
    }
    if (!mediaDevices) {
      setState({
        stream: null,
        acquisitionState: 'unavailable',
        resolution: null,
        error: 'unavailable',
      });
      return;
    }

    let active = true;
    let acquisitionGeneration = 0;
    let acquisitionRunning = false;
    let reacquireQueued = false;
    let acquired: MediaStream | null = null;
    let retryTimer: number | null = null;
    let resolveRetry: (() => void) | null = null;

    const stopTracks = (stream: MediaStream): void => {
      for (const track of stream.getTracks()) track.stop();
    };
    const stopAcquired = (): void => {
      const stream = acquired;
      acquired = null;
      if (stream) stopTracks(stream);
    };
    const cancelRetryWait = (): void => {
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      retryTimer = null;
      const resolve = resolveRetry;
      resolveRetry = null;
      resolve?.();
    };
    const publishStream = (stream: MediaStream, resolution: NegotiatedCameraResolution | null) => {
      acquired = stream;
      setState({
        stream,
        acquisitionState: resolution === null ? 'initializing' : 'ready',
        resolution,
        error: null,
      });
    };
    const acceptStream = (stream: MediaStream, generation: number): boolean => {
      if (!active || generation !== acquisitionGeneration) {
        stopTracks(stream);
        return false;
      }
      stopAcquired();
      const videoTrack = stream.getVideoTracks()[0] ?? stream.getTracks()[0];
      const settings = videoTrack?.getSettings();
      const resolution = negotiatedResolution(settings?.width, settings?.height);
      for (const track of stream.getTracks()) {
        if (typeof track.addEventListener === 'function') {
          track.addEventListener(
            'ended',
            () => {
              if (active && generation === acquisitionGeneration) startAcquisition();
            },
            { once: true },
          );
        }
      }
      publishStream(stream, resolution);
      return true;
    };

    const open = async (generation: number) => {
      for (let attempt = 0; attempt < ACQUISITION_ATTEMPTS; attempt += 1) {
        if (attempt > 0) {
          await new Promise<void>((resolve) => {
            resolveRetry = resolve;
            retryTimer = window.setTimeout(() => {
              retryTimer = null;
              resolveRetry = null;
              resolve();
            }, RETRY_BACKOFF_MS * attempt);
          });
          if (!active || generation !== acquisitionGeneration) return;
        }
        const devices = await enumerateVideoDevices();
        if (!active || generation !== acquisitionGeneration) return;
        try {
          const stream = await mediaDevices.getUserMedia({
            audio: false,
            video: candidateConstraints(deviceId, devices, requestedResolution),
          });
          acceptStream(stream, generation);
          return;
        } catch (error) {
          if (permissionWasDenied(error)) {
            if (generation === acquisitionGeneration) {
              stopAcquired();
              setState({
                stream: null,
                acquisitionState: 'permission-denied',
                resolution: null,
                error: 'permission-denied',
              });
            }
            return;
          }
        }
      }
      if (active && generation === acquisitionGeneration) {
        stopAcquired();
        setState({
          stream: null,
          acquisitionState: 'unavailable',
          resolution: null,
          error: 'unavailable',
        });
      }
    };

    function runCurrentAcquisition(): void {
      acquisitionRunning = true;
      const generation = acquisitionGeneration;
      void open(generation).finally(() => {
        acquisitionRunning = false;
        if (active && reacquireQueued) {
          reacquireQueued = false;
          runCurrentAcquisition();
        }
      });
    }

    function startAcquisition(): void {
      acquisitionGeneration += 1;
      cancelRetryWait();
      stopAcquired();
      if (!active) return;
      setState({
        stream: null,
        acquisitionState: 'initializing',
        resolution: null,
        error: null,
      });
      if (acquisitionRunning) {
        reacquireQueued = true;
        return;
      }
      runCurrentAcquisition();
    }

    const handleDeviceChange = () => startAcquisition();
    const target = mediaDevices as unknown as Partial<EventTarget>;
    if (typeof target.addEventListener === 'function') {
      target.addEventListener('devicechange', handleDeviceChange);
    }

    startAcquisition();
    return () => {
      active = false;
      acquisitionGeneration += 1;
      reacquireQueued = false;
      cancelRetryWait();
      if (typeof target.removeEventListener === 'function') {
        target.removeEventListener('devicechange', handleDeviceChange);
      }
      stopAcquired();
      const element = videoElementRef.current;
      if (element) element.srcObject = null;
      setState({ stream: null, acquisitionState: 'disabled', resolution: null, error: null });
    };
  }, [deviceId, enabled, requestedResolution]);

  const applyIntrinsicResolution = useCallback((element: HTMLVideoElement, stream: MediaStream) => {
    const resolution = negotiatedResolution(element.videoWidth, element.videoHeight);
    if (!resolution) return;
    setState((previous) => {
      if (previous.stream !== stream || previous.resolution !== null) return previous;
      return { ...previous, acquisitionState: 'ready', resolution };
    });
  }, []);

  const videoRef = useCallback(
    (element: HTMLVideoElement | null) => {
      const previous = videoElementRef.current;
      if (previous && previous !== element) previous.srcObject = null;
      videoElementRef.current = element;
      if (!element) return;
      if (element.srcObject !== state.stream) element.srcObject = state.stream;
      const stream = state.stream;
      if (stream && state.resolution === null) {
        applyIntrinsicResolution(element, stream);
        element.addEventListener(
          'loadedmetadata',
          () => applyIntrinsicResolution(element, stream),
          { once: true },
        );
      }
    },
    [applyIntrinsicResolution, state.resolution, state.stream],
  );

  useEffect(() => {
    const element = videoElementRef.current;
    if (element && element.srcObject !== state.stream) element.srcObject = state.stream;
    if (element && state.stream && state.resolution === null) {
      applyIntrinsicResolution(element, state.stream);
    }
  }, [applyIntrinsicResolution, state.resolution, state.stream]);

  const grabJpegBase64 = useCallback((): string | null => {
    const video = videoElementRef.current;
    const width = video?.videoWidth ?? 0;
    const height = video?.videoHeight ?? 0;
    if (!video || width === 0 || height === 0) return null;
    const canvas = (canvasRef.current ??= document.createElement('canvas'));
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.drawImage(video, 0, 0, width, height);
    const dataUrl = canvas.toDataURL('image/jpeg', CAPTURE_QUALITY);
    const separator = dataUrl.indexOf(',');
    return separator === -1 ? null : dataUrl.slice(separator + 1);
  }, []);

  return {
    ...state,
    ready: state.acquisitionState === 'ready',
    denied: state.acquisitionState === 'permission-denied',
    videoRef,
    grabJpegBase64,
  };
}
