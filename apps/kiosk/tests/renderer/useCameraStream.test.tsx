// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest';

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import type { CameraResolution } from '@grace-booth/shared';

import { useCameraStream } from '../../src/renderer/hooks/useCameraStream';

type DeviceLike = { deviceId: string; kind: string; label: string; groupId: string };

type FakeTrack = {
  addEventListener: Mock;
  emitEnded: () => void;
  getSettings: Mock;
  stop: Mock;
};

type FakeStream = {
  getTracks: () => FakeTrack[];
  getVideoTracks: () => FakeTrack[];
  track: FakeTrack;
};

function makeStream(width = 1_920, height = 1_080): FakeStream {
  let ended: (() => void) | null = null;
  const track: FakeTrack = {
    addEventListener: vi.fn((event: string, listener: () => void) => {
      if (event === 'ended') ended = listener;
    }),
    emitEnded: () => ended?.(),
    getSettings: vi.fn(() => ({ width, height })),
    stop: vi.fn(),
  };
  return {
    getTracks: () => [track],
    getVideoTracks: () => [track],
    track,
  };
}

function stubMediaDevices(
  devices: DeviceLike[],
  getUserMedia: Mock,
): { emitDeviceChange: () => void; enumerateDevices: Mock; getUserMedia: Mock } {
  let deviceChange: (() => void) | null = null;
  const mediaDevices = {
    addEventListener: vi.fn((event: string, listener: () => void) => {
      if (event === 'devicechange') deviceChange = listener;
    }),
    removeEventListener: vi.fn(),
    enumerateDevices: vi.fn(() => Promise.resolve(devices)),
    getUserMedia,
  };
  vi.stubGlobal('navigator', { mediaDevices });
  return { ...mediaDevices, emitDeviceChange: () => deviceChange?.() };
}

const ONE_DEVICE: DeviceLike[] = [
  { deviceId: 'camo-camera', kind: 'videoinput', label: 'Camo', groupId: 'g1' },
];

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  cleanupHook();
});

let mounted: { unmount: () => void } | null = null;

function cleanupHook(): void {
  act(() => {
    mounted?.unmount();
  });
  mounted = null;
}

function expectPreferredConstraints(
  getUserMedia: Mock,
  deviceId: string,
  width: number,
  height: number,
): void {
  for (const [input] of getUserMedia.mock.calls as [{ video: MediaTrackConstraints }][]) {
    expect(input.video).toMatchObject({
      deviceId: { exact: deviceId },
      width: { ideal: width },
      height: { ideal: height },
    });
    expect(input.video.width).not.toHaveProperty('min');
    expect(input.video.height).not.toHaveProperty('min');
  }
}

describe('useCameraStream lifecycle', () => {
  it('requests Camo at 720p without hard minimums and releases it when disabled', async () => {
    const stream = makeStream(1_280, 720);
    const getUserMedia = vi.fn(() => Promise.resolve(stream));
    const mediaDevices = stubMediaDevices(ONE_DEVICE, getUserMedia);
    const { result, rerender, unmount } = renderHook(
      ({ enabled }) => useCameraStream(enabled, 'camo-camera', '720p'),
      { initialProps: { enabled: false } },
    );
    mounted = { unmount };

    expect(result.current.acquisitionState).toBe('disabled');
    rerender({ enabled: true });
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.resolution).toEqual({ width: 1_280, height: 720 });
    expect(mediaDevices.enumerateDevices).toHaveBeenCalledOnce();
    expectPreferredConstraints(getUserMedia, 'camo-camera', 1_280, 720);

    rerender({ enabled: false });
    await waitFor(() => expect(result.current.acquisitionState).toBe('disabled'));
    expect(stream.track.stop).toHaveBeenCalledOnce();
  });

  it('requests 1080p as a preference and accepts the actual camera resolution', async () => {
    const stream = makeStream(1_280, 720);
    const getUserMedia = vi.fn(() => Promise.resolve(stream));
    stubMediaDevices(ONE_DEVICE, getUserMedia);
    const { result, unmount } = renderHook(() => useCameraStream(true, 'camo-camera', '1080p'));
    mounted = { unmount };

    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.resolution).toEqual({ width: 1_280, height: 720 });
    expectPreferredConstraints(getUserMedia, 'camo-camera', 1_920, 1_080);
  });

  it('restarts the exact device when the operator changes resolution', async () => {
    const first = makeStream(1_280, 720);
    const second = makeStream(1_920, 1_080);
    const getUserMedia = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    stubMediaDevices(ONE_DEVICE, getUserMedia);
    const { result, rerender, unmount } = renderHook(
      ({ resolution }) => useCameraStream(true, 'camo-camera', resolution),
      { initialProps: { resolution: '720p' as CameraResolution } },
    );
    mounted = { unmount };
    await waitFor(() => expect(result.current.stream).toBe(first));

    rerender({ resolution: '1080p' as const });
    await waitFor(() => expect(result.current.stream).toBe(second));
    expect(first.track.stop).toHaveBeenCalledOnce();
    const calls = getUserMedia.mock.calls as unknown as [
      [MediaStreamConstraints],
      [MediaStreamConstraints],
    ];
    expect(calls[0][0].video).toMatchObject({ width: { ideal: 1_280 } });
    expect(calls[1][0].video).toMatchObject({ width: { ideal: 1_920 } });
  });

  it('falls back to video intrinsic dimensions when track settings omit resolution', async () => {
    const stream = makeStream();
    stream.track.getSettings.mockReturnValue({});
    stubMediaDevices(
      ONE_DEVICE,
      vi.fn(() => Promise.resolve(stream)),
    );
    const { result, unmount } = renderHook(() => useCameraStream(true, 'camo-camera', '720p'));
    mounted = { unmount };
    await waitFor(() => expect(result.current.stream).toBe(stream));
    expect(result.current.acquisitionState).toBe('initializing');

    const video = {
      addEventListener: vi.fn(),
      srcObject: null,
      videoHeight: 720,
      videoWidth: 1_280,
    } as unknown as HTMLVideoElement;
    act(() => result.current.videoRef(video));
    await waitFor(() => expect(result.current.acquisitionState).toBe('ready'));
    expect(result.current.resolution).toEqual({ width: 1_280, height: 720 });
  });

  it('never switches away from an unavailable exact selected device', async () => {
    const getUserMedia = vi.fn(() =>
      Promise.reject(new DOMException('Device not found', 'NotFoundError')),
    );
    stubMediaDevices(ONE_DEVICE, getUserMedia);
    const { result, unmount } = renderHook(() => useCameraStream(true, 'removed-device', '720p'));
    mounted = { unmount };

    await waitFor(() => expect(result.current.acquisitionState).toBe('unavailable'), {
      timeout: 5_000,
    });
    expect(getUserMedia).toHaveBeenCalledTimes(3);
    expectPreferredConstraints(getUserMedia, 'removed-device', 1_280, 720);
  }, 10_000);

  it('classifies permission denial without retrying', async () => {
    const getUserMedia = vi.fn(() =>
      Promise.reject(new DOMException('Permission denied', 'NotAllowedError')),
    );
    stubMediaDevices(ONE_DEVICE, getUserMedia);
    const { result, unmount } = renderHook(() => useCameraStream(true, 'camo-camera', '720p'));
    mounted = { unmount };

    await waitFor(() => expect(result.current.acquisitionState).toBe('permission-denied'));
    expect(result.current.denied).toBe(true);
    expect(getUserMedia).toHaveBeenCalledOnce();
  });

  it('retries in-use failures before reporting unavailable', async () => {
    const getUserMedia = vi.fn(() =>
      Promise.reject(new DOMException('Camera in use', 'NotReadableError')),
    );
    stubMediaDevices(ONE_DEVICE, getUserMedia);
    const { result, unmount } = renderHook(() => useCameraStream(true, 'camo-camera', '720p'));
    mounted = { unmount };

    await waitFor(() => expect(result.current.acquisitionState).toBe('unavailable'), {
      timeout: 5_000,
    });
    expect(getUserMedia).toHaveBeenCalledTimes(3);
  }, 10_000);

  it('re-enumerates and reacquires after a track ends', async () => {
    const first = makeStream();
    const second = makeStream();
    const getUserMedia = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const mediaDevices = stubMediaDevices(ONE_DEVICE, getUserMedia);
    const { result, unmount } = renderHook(() => useCameraStream(true, 'camo-camera', '1080p'));
    mounted = { unmount };
    await waitFor(() => expect(result.current.stream).toBe(first));

    act(() => first.track.emitEnded());
    await waitFor(() => expect(result.current.stream).toBe(second));
    expect(first.track.stop).toHaveBeenCalledOnce();
    expect(mediaDevices.enumerateDevices).toHaveBeenCalledTimes(2);
  });

  it('serializes acquisition when devices change during a pending request', async () => {
    const first = makeStream();
    const second = makeStream();
    let resolveFirst: ((stream: FakeStream) => void) | null = null;
    const getUserMedia = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<FakeStream>((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValueOnce(second);
    const mediaDevices = stubMediaDevices(ONE_DEVICE, getUserMedia);
    const { result, unmount } = renderHook(() => useCameraStream(true, 'camo-camera', '720p'));
    mounted = { unmount };
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledOnce());

    act(() => mediaDevices.emitDeviceChange());
    expect(getUserMedia).toHaveBeenCalledOnce();
    await act(async () => {
      resolveFirst?.(first);
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.stream).toBe(second));
    expect(first.track.stop).toHaveBeenCalledOnce();
  });
});
