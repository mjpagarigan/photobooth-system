// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi, type Mocked } from 'vitest';

import type { GalleryItem, GraceBoothBridge, QrStationState } from '@grace-booth/shared';

import { QrStationScreen } from '../../src/renderer/screens/QrStationScreen';

const IDLE_STATE: QrStationState = {
  status: 'idle',
  sessionId: null,
  collageUrl: null,
  qrImageUrl: null,
  expiresAt: null,
  durationSeconds: 45,
  message: null,
  canRetryUpload: false,
  canFinishOffline: false,
};

describe('QrStationScreen', () => {
  let mockBridge: {
    qrStation: Mocked<GraceBoothBridge['qrStation']>;
    gallery: Mocked<Pick<GraceBoothBridge['gallery'], 'getRecent'>>;
  };

  beforeEach(() => {
    mockBridge = {
      qrStation: {
        getState: vi.fn().mockResolvedValue({
          ok: true,
          data: IDLE_STATE,
        }),
        dismiss: vi.fn().mockResolvedValue({
          ok: true,
          data: IDLE_STATE,
        }),
        retryUpload: vi.fn().mockResolvedValue({
          ok: true,
          data: IDLE_STATE,
        }),
        finishOffline: vi.fn().mockResolvedValue({
          ok: true,
          data: IDLE_STATE,
        }),
        subscribe: vi.fn().mockReturnValue(vi.fn()),
      },
      gallery: {
        getRecent: vi.fn().mockResolvedValue({
          ok: true,
          data: [],
        }),
      },
    };
    window.graceBooth = mockBridge as unknown as GraceBoothBridge;
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
    delete window.graceBooth;
  });

  it('renders idle screen with background and recent button when status is idle', async () => {
    render(<QrStationScreen />);

    await waitFor(() => {
      expect(screen.getByTestId('qr-station-idle')).toBeInTheDocument();
    });

    const recentButton = screen.getByRole('button', { name: /recent photos/i });
    expect(recentButton).toBeInTheDocument();
    expect(screen.getByTestId('qr-station-idle')).toHaveClass('screen--qr-station');
    const idleHeading = screen.getByRole('heading', { name: 'Your photo appears here.' });
    expect(idleHeading).toHaveAttribute('data-screen-heading');
    expect(idleHeading).toHaveAttribute('tabindex', '-1');
    expect(screen.getByRole('img', { name: 'M.A.T. Media and Technology' })).toHaveAttribute(
      'src',
      '/backgrounds/ministry-idle.jpg',
    );
    expect(screen.queryByAltText(/qr code for photo download/i)).not.toBeInTheDocument();
  });

  it('renders active QR screen with collage, QR code and countdown timer', async () => {
    mockBridge.qrStation.getState.mockResolvedValue({
      ok: true,
      data: {
        status: 'active',
        sessionId: '11111111-1111-4111-8111-111111111111',
        collageUrl: 'grace-booth-media://asset/collage-1',
        qrImageUrl: 'data:image/png;base64,mockqr',
        expiresAt: Date.now() + 90_000,
        durationSeconds: 90,
        message: null,
        canRetryUpload: false,
        canFinishOffline: false,
      },
    });

    render(<QrStationScreen />);

    await waitFor(() => {
      expect(screen.getByTestId('qr-station-active')).toBeInTheDocument();
    });

    expect(
      screen.getByRole('heading', { name: /you’re all set\. scan to take it home\./i }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('qr-station-active')).toHaveClass('screen--qr-station');
    expect(screen.getByRole('button', { name: /recent photos/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /done/i })).toBeInTheDocument();
    expect(screen.getByAltText(/qr code for photo download/i)).toBeInTheDocument();
    expect(document.querySelector('.photostrip--collage')).toHaveAttribute(
      'data-media-fit',
      'intrinsic',
    );
    await waitFor(() => {
      expect(screen.getByText(/clears in 90s/i)).toBeInTheDocument();
    });
  });

  it('renders a self-clearing error state for a failed newest session', async () => {
    mockBridge.qrStation.getState.mockResolvedValue({
      ok: true,
      data: {
        status: 'error',
        sessionId: '11111111-1111-4111-8111-111111111111',
        collageUrl: 'grace-booth-media://asset/collage-1',
        qrImageUrl: null,
        expiresAt: Date.now() + 30_000,
        durationSeconds: 45,
        message: 'Upload failed. Ask an operator for help.',
        canRetryUpload: false,
        canFinishOffline: false,
      },
    });

    render(<QrStationScreen />);

    await waitFor(() => {
      expect(screen.getByTestId('qr-station-error')).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.getByText(/clears in 30s/i)).toBeInTheDocument();
    });
  });

  it('calls bridge dismiss when Done button is clicked', async () => {
    const user = userEvent.setup();
    mockBridge.qrStation.getState.mockResolvedValue({
      ok: true,
      data: {
        status: 'active',
        sessionId: '11111111-1111-4111-8111-111111111111',
        collageUrl: 'grace-booth-media://asset/collage-1',
        qrImageUrl: 'data:image/png;base64,mockqr',
        expiresAt: Date.now() + 45000,
        durationSeconds: 45,
        message: null,
        canRetryUpload: false,
        canFinishOffline: false,
      },
    });

    render(<QrStationScreen />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /done/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /done/i }));
    expect(mockBridge.qrStation.dismiss.mock.calls[0]).toEqual([
      '11111111-1111-4111-8111-111111111111',
    ]);
  });

  it('opens RecentGallery in dark tone from both active and error states', async () => {
    const user = userEvent.setup();
    mockBridge.qrStation.getState.mockResolvedValue({
      ok: true,
      data: {
        status: 'error',
        sessionId: '11111111-1111-4111-8111-111111111111',
        collageUrl: 'grace-booth-media://asset/collage-1',
        qrImageUrl: null,
        expiresAt: Date.now() + 30_000,
        durationSeconds: 45,
        message: 'Upload failed. Ask an operator for help.',
        canRetryUpload: false,
        canFinishOffline: false,
      },
    });

    const { unmount } = render(<QrStationScreen />);
    await screen.findByTestId('qr-station-error');

    await user.click(screen.getByRole('button', { name: /recent photos/i }));
    expect(await screen.findByRole('dialog')).toHaveAttribute('data-tone', 'dark');
    expect(mockBridge.gallery.getRecent.mock.calls).toEqual([[]]);
    unmount();

    mockBridge.qrStation.getState.mockResolvedValue({
      ok: true,
      data: {
        status: 'active',
        sessionId: '11111111-1111-4111-8111-111111111111',
        collageUrl: 'grace-booth-media://asset/collage-1',
        qrImageUrl: 'data:image/png;base64,mockqr',
        expiresAt: Date.now() + 45_000,
        durationSeconds: 45,
        message: null,
        canRetryUpload: false,
        canFinishOffline: false,
      },
    });

    render(<QrStationScreen />);
    await screen.findByTestId('qr-station-active');
    await user.click(screen.getByRole('button', { name: /recent photos/i }));
    expect(await screen.findByRole('dialog')).toHaveAttribute('data-tone', 'dark');
    expect(mockBridge.gallery.getRecent.mock.calls).toEqual([[], []]);
  });

  it('clears stale items while reopening and ignores responses after closing', async () => {
    const user = userEvent.setup();
    const oldItem: GalleryItem = {
      sessionId: '11111111-1111-4111-8111-111111111111',
      previewUrl: 'grace-booth-media://asset/old-preview',
      detailUrl: 'grace-booth-media://asset/old-detail',
      qrDataUrl: null,
      metadata: {
        capturedAt: new Date(2026, 10, 28, 22, 0, 0).getTime(),
        photoCount: 3,
        frameName: 'Test',
        uploadStatus: 'uploaded',
        cloudExpiresAt: null,
        printable: false,
      },
    };
    let resolveSecond!: (
      value: Awaited<ReturnType<GraceBoothBridge['gallery']['getRecent']>>,
    ) => void;
    mockBridge.gallery.getRecent
      .mockResolvedValueOnce({ ok: true, data: [oldItem] })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSecond = resolve;
          }),
      );

    render(<QrStationScreen />);
    await screen.findByTestId('qr-station-idle');

    await user.click(screen.getByRole('button', { name: /recent photos/i }));
    expect(await screen.findByTestId('gallery-item-1')).toBeVisible();

    await user.click(screen.getByRole('button', { name: /close recent photos/i }));
    await waitFor(() => expect(screen.queryByTestId('recent-gallery')).not.toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /recent photos/i }));
    expect(screen.getByRole('status')).toHaveTextContent(/loading recent photos/i);
    expect(screen.queryByTestId('gallery-item-1')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /close recent photos/i }));
    resolveSecond({ ok: true, data: [oldItem] });
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByTestId('recent-gallery')).not.toBeInTheDocument();
  });

  it('auto-refreshes open RecentGallery after local midnight and clears timer on close', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 28, 23, 59, 55, 0));

    const yesterdayItem: GalleryItem = {
      sessionId: '11111111-1111-4111-8111-111111111111',
      previewUrl: 'grace-booth-media://asset/yesterday-preview',
      detailUrl: 'grace-booth-media://asset/yesterday-detail',
      qrDataUrl: null,
      metadata: {
        capturedAt: new Date(2026, 10, 28, 23, 30, 0).getTime(),
        photoCount: 3,
        frameName: 'Test',
        uploadStatus: 'uploaded',
        cloudExpiresAt: null,
        printable: false,
      },
    };
    const todayItem: GalleryItem = {
      sessionId: '22222222-2222-4222-8222-222222222222',
      previewUrl: 'grace-booth-media://asset/today-preview',
      detailUrl: 'grace-booth-media://asset/today-detail',
      qrDataUrl: null,
      metadata: {
        capturedAt: new Date(2026, 10, 29, 0, 0, 0).getTime(),
        photoCount: 3,
        frameName: 'Test',
        uploadStatus: 'uploaded',
        cloudExpiresAt: null,
        printable: false,
      },
    };
    mockBridge.gallery.getRecent
      .mockResolvedValueOnce({ ok: true, data: [yesterdayItem] })
      .mockResolvedValueOnce({ ok: true, data: [todayItem] });

    render(<QrStationScreen />);
    await act(async () => {
      await Promise.resolve();
    });

    fireEvent.click(screen.getByRole('button', { name: /recent photos/i }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockBridge.gallery.getRecent).toHaveBeenCalledTimes(1);
    expect(
      screen.getByTestId('gallery-item-1').querySelector('.gallery-tile__preview'),
    ).toHaveAttribute('src', yesterdayItem.previewUrl);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_249);
    });
    expect(mockBridge.gallery.getRecent).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
      await Promise.resolve();
    });
    expect(mockBridge.gallery.getRecent).toHaveBeenCalledTimes(2);
    expect(
      screen.getByTestId('gallery-item-1').querySelector('.gallery-tile__preview'),
    ).toHaveAttribute('src', todayItem.previewUrl);

    fireEvent.click(screen.getByRole('button', { name: /close recent photos/i }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1_000 + 1_000);
    });
    expect(mockBridge.gallery.getRecent).toHaveBeenCalledTimes(2);
  });

  it('marks Done busy while dismiss is in flight and blocks duplicate requests', async () => {
    const user = userEvent.setup();
    let resolveDismiss!: (
      value: Awaited<ReturnType<GraceBoothBridge['qrStation']['dismiss']>>,
    ) => void;
    mockBridge.qrStation.getState.mockResolvedValue({
      ok: true,
      data: {
        status: 'active',
        sessionId: '11111111-1111-4111-8111-111111111111',
        collageUrl: 'grace-booth-media://asset/collage-1',
        qrImageUrl: 'data:image/png;base64,mockqr',
        expiresAt: Date.now() + 45_000,
        durationSeconds: 45,
        message: null,
        canRetryUpload: false,
        canFinishOffline: false,
      },
    });
    mockBridge.qrStation.dismiss.mockReturnValue(
      new Promise((resolve) => {
        resolveDismiss = resolve;
      }),
    );

    render(<QrStationScreen />);
    const doneButton = await screen.findByRole('button', { name: /done/i });

    await user.click(doneButton);
    expect(doneButton).toBeDisabled();
    expect(doneButton).toHaveAttribute('aria-busy', 'true');
    await user.click(doneButton);
    expect(mockBridge.qrStation.dismiss.mock.calls).toHaveLength(1);

    resolveDismiss({
      ok: true,
      data: {
        status: 'idle',
        sessionId: null,
        collageUrl: null,
        qrImageUrl: null,
        expiresAt: null,
        durationSeconds: 45,
        message: null,
        canRetryUpload: false,
        canFinishOffline: false,
      },
    });
    expect(await screen.findByTestId('qr-station-idle')).toBeVisible();
  });

  it('renders live session print status transitions in active and error states without window.graceBooth.print', async () => {
    let stationListener: ((state: QrStationState) => void) | null = null;
    mockBridge.qrStation.subscribe.mockImplementation((listener) => {
      stationListener = listener;
      return vi.fn();
    });
    mockBridge.qrStation.getState.mockResolvedValue({
      ok: true,
      data: {
        status: 'active',
        sessionId: '11111111-1111-4111-8111-111111111111',
        collageUrl: 'grace-booth-media://asset/collage-1',
        qrImageUrl: 'data:image/png;base64,mockqr',
        expiresAt: Date.now() + 45_000,
        durationSeconds: 45,
        message: null,
        canRetryUpload: false,
        canFinishOffline: false,
        printStatus: {
          phase: 'printing',
          origin: 'session',
          stage: 'active',
          printedCopies: 0,
          remainingCopies: 2,
          totalCopies: 2,
        },
      },
    });

    render(<QrStationScreen />);

    await waitFor(() => {
      expect(screen.getByTestId('qr-station-active')).toBeInTheDocument();
    });
    const activeStatus = screen.getByTestId('session-print-status');
    expect(activeStatus).toHaveAttribute('data-tone', 'dark');
    expect(activeStatus).toHaveAttribute('data-print-phase', 'printing');
    expect(activeStatus).toHaveTextContent('Printing copy 1 of 2…');

    act(() => {
      stationListener?.({
        status: 'active',
        sessionId: '11111111-1111-4111-8111-111111111111',
        collageUrl: 'grace-booth-media://asset/collage-1',
        qrImageUrl: 'data:image/png;base64,mockqr',
        expiresAt: Date.now() + 45_000,
        durationSeconds: 45,
        message: null,
        canRetryUpload: false,
        canFinishOffline: false,
        printStatus: {
          phase: 'completed',
          origin: 'session',
          totalCopies: 2,
          completedAt: 5_000,
        },
      });
    });

    expect(screen.getByTestId('session-print-status')).toHaveAttribute(
      'data-print-phase',
      'completed',
    );
    expect(screen.getByTestId('session-print-status')).toHaveTextContent(
      'Print finished · 2 copies',
    );

    act(() => {
      stationListener?.({
        status: 'error',
        sessionId: '11111111-1111-4111-8111-111111111111',
        collageUrl: 'grace-booth-media://asset/collage-1',
        qrImageUrl: null,
        expiresAt: Date.now() + 30_000,
        durationSeconds: 45,
        message: 'Upload failed. Ask an operator for help.',
        canRetryUpload: false,
        canFinishOffline: false,
        printStatus: {
          phase: 'completed',
          origin: 'session',
          totalCopies: 1,
          completedAt: 6_000,
        },
      });
    });

    expect(screen.getByTestId('qr-station-error')).toBeInTheDocument();
    expect(screen.getByTestId('session-print-status')).toHaveTextContent('Print finished');
  });

  it('shows holding state while printing and local Wi-Fi delivery copy for offline receipts', async () => {
    let stationListener: ((state: QrStationState) => void) | null = null;
    mockBridge.qrStation.subscribe.mockImplementation((listener) => {
      stationListener = listener;
      return vi.fn();
    });
    mockBridge.qrStation.getState.mockResolvedValue({
      ok: true,
      data: {
        status: 'active',
        sessionId: '11111111-1111-4111-8111-111111111111',
        collageUrl: 'grace-booth-media://asset/collage-1',
        qrImageUrl: 'data:image/png;base64,mockqr',
        expiresAt: null,
        durationSeconds: 45,
        message: null,
        canRetryUpload: false,
        canFinishOffline: false,
        deliveryMode: 'offline',
        printStatus: {
          phase: 'printing',
          origin: 'session',
          stage: 'active',
          printedCopies: 0,
          remainingCopies: 2,
          totalCopies: 2,
        },
      },
    });

    render(<QrStationScreen />);

    await screen.findByTestId('qr-station-active');
    expect(screen.getByText('Holding while printing')).toBeVisible();
    expect(screen.queryByText(/clears in/i)).not.toBeInTheDocument();
    expect(
      screen.getByText('Local Wi-Fi · Connect your phone to the booth Wi-Fi, then scan'),
    ).toBeVisible();
    expect(screen.queryByText('Available for 30 days')).not.toBeInTheDocument();

    act(() => {
      stationListener?.({
        status: 'active',
        sessionId: '11111111-1111-4111-8111-111111111111',
        collageUrl: 'grace-booth-media://asset/collage-1',
        qrImageUrl: 'data:image/png;base64,mockqr',
        expiresAt: Date.now() + 45_000,
        durationSeconds: 45,
        message: null,
        canRetryUpload: false,
        canFinishOffline: false,
        deliveryMode: 'offline',
        printStatus: {
          phase: 'completed',
          origin: 'session',
          totalCopies: 2,
          completedAt: 5_000,
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByText(/clears in 45s/i)).toBeVisible();
    });
    expect(screen.queryByText('Holding while printing')).not.toBeInTheDocument();
  });

  it('wires Retry upload and Finish offline recovery actions in error state', async () => {
    const user = userEvent.setup();
    const sessionId = '11111111-1111-4111-8111-111111111111';
    mockBridge.qrStation.getState.mockResolvedValue({
      ok: true,
      data: {
        status: 'error',
        sessionId,
        collageUrl: 'grace-booth-media://asset/collage-1',
        qrImageUrl: null,
        expiresAt: Date.now() + 45_000,
        durationSeconds: 45,
        message: 'Your photo is safe on this booth.',
        canRetryUpload: true,
        canFinishOffline: true,
      },
    });
    mockBridge.qrStation.retryUpload.mockResolvedValue({
      ok: true,
      data: {
        status: 'error',
        sessionId,
        collageUrl: 'grace-booth-media://asset/collage-1',
        qrImageUrl: null,
        expiresAt: Date.now() + 45_000,
        durationSeconds: 45,
        message: 'Retrying cloud upload…',
        canRetryUpload: false,
        canFinishOffline: true,
      },
    });
    mockBridge.qrStation.finishOffline.mockResolvedValue({
      ok: true,
      data: {
        status: 'active',
        sessionId,
        collageUrl: 'grace-booth-media://asset/collage-1',
        qrImageUrl: 'data:image/png;base64,mockqr',
        expiresAt: Date.now() + 45_000,
        durationSeconds: 45,
        message: null,
        canRetryUpload: false,
        canFinishOffline: false,
        deliveryMode: 'offline',
      },
    });

    render(<QrStationScreen />);

    await screen.findByTestId('qr-station-error');
    await user.click(screen.getByRole('button', { name: 'Retry upload' }));
    expect(mockBridge.qrStation.retryUpload.mock.calls).toEqual([[sessionId]]);
    expect(await screen.findByText('Retrying cloud upload…')).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Finish offline' }));
    expect(mockBridge.qrStation.finishOffline.mock.calls).toEqual([[sessionId]]);
    expect(await screen.findByTestId('qr-station-active')).toBeVisible();
    expect(
      screen.getByText('Local Wi-Fi · Connect your phone to the booth Wi-Fi, then scan'),
    ).toBeVisible();
  });
});
