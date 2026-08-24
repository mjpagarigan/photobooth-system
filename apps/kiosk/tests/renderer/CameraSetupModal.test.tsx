// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest';

import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CameraResolution, GraceBoothBridge } from '@grace-booth/shared';

import { CameraSetupModal } from '../../src/renderer/components/CameraSetupModal';

function streamAt(width: number, height: number) {
  const track = {
    addEventListener: vi.fn(),
    getSettings: vi.fn(() => ({ width, height })),
    stop: vi.fn(),
  };
  return {
    getTracks: () => [track],
    getVideoTracks: () => [track],
    track,
  };
}

function cameraConfiguration(
  adapter: 'webcam' | 'sony',
  deviceId: string | null,
  resolution: CameraResolution = '1080p',
) {
  return {
    ok: true as const,
    data: {
      adapter,
      deviceId,
      resolution,
      status: {
        adapter,
        state: adapter === 'sony' ? ('unsupported' as const) : ('ready' as const),
        code: adapter === 'sony' ? 'sony_adapter_unavailable' : null,
        operatorMessage: adapter === 'sony' ? 'Unsupported' : 'Ready',
        capabilities: { stillCapture: adapter !== 'sony', preview: adapter !== 'sony' },
        checkedAt: 1,
      },
    },
  };
}

function installBridge(getCameras: GraceBoothBridge['booth']['getCameras']) {
  const setCamera = vi
    .fn<GraceBoothBridge['booth']['setCamera']>()
    .mockResolvedValue(cameraConfiguration('webcam', 'camo-camera', '720p'));
  window.graceBooth = {
    booth: { getCameras, setCamera },
  } as unknown as GraceBoothBridge;
  return setCamera;
}

function stubCamo(getUserMedia: ReturnType<typeof vi.fn>): void {
  vi.stubGlobal('navigator', {
    mediaDevices: {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      enumerateDevices: vi.fn(() =>
        Promise.resolve([
          { deviceId: 'camo-camera', kind: 'videoinput', label: 'Camo', groupId: 'g1' },
        ]),
      ),
      getUserMedia,
    },
  });
}

beforeEach(() => {
  const assignedStreams = new WeakMap<HTMLMediaElement, MediaProvider | null>();
  Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', {
    configurable: true,
    get(this: HTMLMediaElement) {
      return assignedStreams.get(this) ?? null;
    },
    set(this: HTMLMediaElement, value: MediaProvider | null) {
      assignedStreams.set(this, value);
    },
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete window.graceBooth;
});

describe('CameraSetupModal resolution preferences', () => {
  it('loads Camo at the persisted 720p preference without hard minimum constraints', async () => {
    const stream = streamAt(1_280, 720);
    const getUserMedia = vi.fn(() => Promise.resolve(stream));
    stubCamo(getUserMedia);
    let resolveConfiguration:
      | ((value: Awaited<ReturnType<GraceBoothBridge['booth']['getCameras']>>) => void)
      | null = null;
    const deferredGetCameras: GraceBoothBridge['booth']['getCameras'] = () =>
      new Promise((resolve) => {
        resolveConfiguration = resolve;
      });
    installBridge(deferredGetCameras);

    render(<CameraSetupModal isOpen={true} onClose={vi.fn()} />);
    expect(getUserMedia).not.toHaveBeenCalled();
    await act(async () => {
      resolveConfiguration?.(cameraConfiguration('webcam', 'camo-camera', '720p'));
      await Promise.resolve();
    });

    await waitFor(() => expect(getUserMedia).toHaveBeenCalledOnce());
    const [[constraints]] = getUserMedia.mock.calls as unknown as [[MediaStreamConstraints]];
    const video = constraints.video as MediaTrackConstraints;
    expect(video).toMatchObject({
      deviceId: { exact: 'camo-camera' },
      width: { ideal: 1_280 },
      height: { ideal: 720 },
    });
    expect(video.width).not.toHaveProperty('min');
    expect(screen.getByText('Actual:').parentElement).toHaveTextContent('1280 × 720');
    expect(screen.getByLabelText('Capture Resolution')).toHaveValue('720p');
    expect(screen.getByRole('button', { name: /apply & save/i })).toBeEnabled();
  });

  it('reacquires the preview and persists a changed resolution', async () => {
    const first = streamAt(1_920, 1_080);
    const second = streamAt(1_280, 720);
    const getUserMedia = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    stubCamo(getUserMedia);
    const setCamera = installBridge(
      vi.fn().mockResolvedValue(cameraConfiguration('webcam', 'camo-camera', '1080p')),
    );
    const user = userEvent.setup();
    render(<CameraSetupModal isOpen={true} onClose={vi.fn()} />);

    await waitFor(() => expect(getUserMedia).toHaveBeenCalledOnce());
    await user.selectOptions(screen.getByLabelText('Capture Resolution'), '720p');
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2));
    expect(first.track.stop).toHaveBeenCalledOnce();

    await user.click(screen.getByRole('button', { name: /apply & save/i }));
    expect(setCamera).toHaveBeenCalledWith({
      adapter: 'webcam',
      deviceId: 'camo-camera',
      resolution: '720p',
    });
  });

  it('allows saving Camo even when the live preview is temporarily unavailable', async () => {
    const getUserMedia = vi.fn(() =>
      Promise.reject(new DOMException('Virtual camera is starting', 'NotReadableError')),
    );
    stubCamo(getUserMedia);
    const setCamera = installBridge(
      vi.fn().mockResolvedValue(cameraConfiguration('webcam', 'camo-camera', '720p')),
    );
    const user = userEvent.setup();
    render(<CameraSetupModal isOpen={true} onClose={vi.fn()} />);

    const save = await screen.findByRole('button', { name: /apply & save/i });
    await waitFor(() => expect(save).toBeEnabled());
    await user.click(save);
    expect(setCamera).toHaveBeenCalledWith({
      adapter: 'webcam',
      deviceId: 'camo-camera',
      resolution: '720p',
    });
  });

  it('keeps the native Sony adapter visibly unsupported', async () => {
    const getUserMedia = vi.fn();
    stubCamo(getUserMedia);
    installBridge(vi.fn().mockResolvedValue(cameraConfiguration('sony', null)));
    render(<CameraSetupModal isOpen={true} onClose={vi.fn()} />);

    expect(await screen.findByText(/NATIVE SONY PC REMOTE ADAPTER — NOT AVAILABLE/i)).toBeVisible();
    expect(screen.getByRole('button', { name: /apply & save/i })).toBeDisabled();
    expect(getUserMedia).not.toHaveBeenCalled();
  });
});
