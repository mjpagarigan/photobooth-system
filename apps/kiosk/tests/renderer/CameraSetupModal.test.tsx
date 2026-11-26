// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest';

import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  CameraPreviewFrameEvent,
  CameraResolution,
  GraceBoothBridge,
} from '@grace-booth/shared';

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
  adapter: 'webcam' | 'sony' | 'nikon',
  deviceId: string | null,
  resolution: CameraResolution = '1080p',
  alwaysActive = false,
) {
  return {
    ok: true as const,
    data: {
      adapter,
      deviceId,
      resolution,
      alwaysActive,
      zoomPercent: 100,
      status: {
        adapter,
        state: adapter === 'sony' ? ('unsupported' as const) : ('ready' as const),
        code: adapter === 'sony' ? 'sony_adapter_unavailable' : null,
        operatorMessage:
          adapter === 'sony'
            ? 'Unsupported'
            : adapter === 'nikon'
              ? 'Nikon D5200 is ready on USB (6000x4000, 100% battery).'
              : 'Ready',
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
  const setCameraPreview = vi
    .fn<GraceBoothBridge['booth']['setCameraPreview']>()
    .mockResolvedValue({ ok: true, data: {} });
  const previewListeners = new Set<(frame: CameraPreviewFrameEvent) => void>();
  const onCameraPreviewFrame = vi.fn<GraceBoothBridge['booth']['onCameraPreviewFrame']>(
    (listener) => {
      previewListeners.add(listener);
      return () => {
        previewListeners.delete(listener);
      };
    },
  );
  window.graceBooth = {
    booth: {
      getCameras,
      setCamera,
      setCameraPreview,
      onCameraPreviewFrame,
    },
  } as unknown as GraceBoothBridge;
  (
    window as unknown as {
      __emitPreviewFrame?: (frame: CameraPreviewFrameEvent) => void;
      __setCameraPreviewSpy?: typeof setCameraPreview;
    }
  ).__emitPreviewFrame = (frame: CameraPreviewFrameEvent) => {
    for (const listener of previewListeners) listener(frame);
  };
  (
    window as unknown as {
      __setCameraPreviewSpy?: typeof setCameraPreview;
    }
  ).__setCameraPreviewSpy = setCameraPreview;
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
  it('places keyboard focus inside the dialog when it opens', async () => {
    stubCamo(vi.fn(() => Promise.resolve(streamAt(1_280, 720))));
    installBridge(vi.fn().mockResolvedValue(cameraConfiguration('webcam', null, '720p')));
    render(<CameraSetupModal isOpen={true} onClose={vi.fn()} />);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus());
  });

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
    expect(screen.getByRole('combobox', { name: 'Capture resolution' })).toHaveTextContent('720p');
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
    await user.click(screen.getByRole('combobox', { name: 'Capture resolution' }));
    await user.click(screen.getByRole('option', { name: /720p/i }));
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2));
    expect(first.track.stop).toHaveBeenCalledOnce();

    await user.click(screen.getByRole('button', { name: /apply & save/i }));
    expect(setCamera).toHaveBeenCalledWith({
      adapter: 'webcam',
      alwaysActive: false,
      deviceId: 'camo-camera',
      resolution: '720p',
      zoomPercent: 100,
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
      alwaysActive: false,
      deviceId: 'camo-camera',
      resolution: '720p',
      zoomPercent: 100,
    });
  });

  it('tells the operator to reselect a saved camera that no longer resolves', async () => {
    const getUserMedia = vi.fn(() => Promise.reject(new DOMException('', 'OverconstrainedError')));
    stubCamo(getUserMedia);
    installBridge(
      vi.fn().mockResolvedValue(cameraConfiguration('webcam', '1700340e-stale-id', '1080p')),
    );
    render(<CameraSetupModal isOpen={true} onClose={vi.fn()} />);

    expect(
      await screen.findByText('The selected camera is not connected.', undefined, {
        timeout: 5_000,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Choose the camera again in Active device node, then Apply & Save.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/in use by another app/i)).not.toBeInTheDocument();
  }, 10_000);

  it('loads and persists the always-active webcam preference', async () => {
    stubCamo(vi.fn(() => Promise.resolve(streamAt(1_920, 1_080))));
    const setCamera = installBridge(
      vi.fn().mockResolvedValue(cameraConfiguration('webcam', 'camo-camera', '1080p', true)),
    );
    const user = userEvent.setup();
    render(<CameraSetupModal isOpen={true} onClose={vi.fn()} />);

    const toggle = await screen.findByRole('switch', { name: /keep webcam always active/i });
    expect(toggle).toBeChecked();
    await user.click(toggle);
    await user.click(screen.getByRole('button', { name: /apply & save/i }));

    expect(setCamera).toHaveBeenCalledWith({
      adapter: 'webcam',
      alwaysActive: false,
      deviceId: 'camo-camera',
      resolution: '1080p',
      zoomPercent: 100,
    });
  });

  it('keeps the native Sony adapter visibly unsupported', async () => {
    const getUserMedia = vi.fn();
    stubCamo(getUserMedia);
    installBridge(vi.fn().mockResolvedValue(cameraConfiguration('sony', null)));
    render(<CameraSetupModal isOpen={true} onClose={vi.fn()} />);

    expect(await screen.findByText(/Sony PC Remote adapter unavailable/i)).toBeVisible();
    expect(screen.getByRole('button', { name: /apply & save/i })).toBeDisabled();
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('supports Nikon DSLR single-cable USB mode with live preview and USB shutter status', async () => {
    const getUserMedia = vi.fn();
    stubCamo(getUserMedia);
    const setCamera = installBridge(
      vi.fn().mockResolvedValue(cameraConfiguration('nikon', 'camo-camera', '1080p')),
    );
    const user = userEvent.setup();
    render(<CameraSetupModal isOpen={true} onClose={vi.fn()} />);

    expect(await screen.findByText(/Nikon USB shutter ready/i)).toBeVisible();
    expect(
      screen.getByText(/Nikon D5200 is ready on USB \(6000x4000, 100% battery\)/i),
    ).toBeVisible();
    expect(getUserMedia).not.toHaveBeenCalled();

    const previewSpy = (
      window as unknown as {
        __setCameraPreviewSpy?: ReturnType<typeof vi.fn>;
      }
    ).__setCameraPreviewSpy;
    await waitFor(() => expect(previewSpy).toHaveBeenCalledWith(true, 'nikon'));

    act(() => {
      (
        window as unknown as { __emitPreviewFrame?: (frame: CameraPreviewFrameEvent) => void }
      ).__emitPreviewFrame?.({
        jpegBase64: '/9j/4AAQ',
        width: 640,
        height: 424,
      });
    });

    const previewImg = await screen.findByAltText('Nikon USB live preview');
    expect(previewImg).toHaveAttribute('src', 'data:image/jpeg;base64,/9j/4AAQ');
    expect(screen.getByText('640 × 424')).toBeVisible();

    await user.click(screen.getByRole('button', { name: /apply & save/i }));
    expect(setCamera).toHaveBeenCalledWith({
      adapter: 'nikon',
      alwaysActive: false,
      deviceId: 'camo-camera',
      resolution: '1080p',
      zoomPercent: 100,
    });
  });
});
