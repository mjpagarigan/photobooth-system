// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi, type Mocked } from 'vitest';

import type { GraceBoothBridge } from '@grace-booth/shared';

import { QrStationScreen } from '../../src/renderer/screens/QrStationScreen';

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
          data: {
            status: 'idle',
            sessionId: null,
            collageUrl: null,
            qrImageUrl: null,
            expiresAt: null,
            durationSeconds: 45,
            message: null,
            canRetryUpload: false,
          },
        }),
        dismiss: vi.fn().mockResolvedValue({
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
          },
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
    expect(screen.getByTestId('qr-station-idle')).toHaveClass('screen--final');
    expect(document.querySelector<HTMLImageElement>('img.qr-station__background')).toHaveAttribute(
      'src',
      '/backgrounds/ministry-idle.jpg',
    );
    expect(screen.queryByText(/please scan the qr code/i)).not.toBeInTheDocument();
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
        queuedCount: 0,
        message: null,
        canRetryUpload: false,
      },
    });

    render(<QrStationScreen />);

    await waitFor(() => {
      expect(screen.getByTestId('qr-station-active')).toBeInTheDocument();
    });

    expect(
      screen.getByText(/please scan the qr code beside to download the photo/i),
    ).toBeInTheDocument();
    expect(screen.getByTestId('qr-station-active')).toHaveClass('screen--final');
    expect(screen.getByRole('button', { name: /recent photos/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /done/i })).toBeInTheDocument();
    expect(screen.getByAltText(/qr code for photo download/i)).toBeInTheDocument();
    expect(document.querySelector('.photostrip--collage')).toHaveAttribute(
      'data-media-fit',
      'intrinsic',
    );
    await waitFor(() => {
      expect(screen.getByText(/auto-clearing in 90s/i)).toBeInTheDocument();
    });
  });

  it('renders replacement countdown label when queuedCount > 0', async () => {
    mockBridge.qrStation.getState.mockResolvedValue({
      ok: true,
      data: {
        status: 'active',
        sessionId: '11111111-1111-4111-8111-111111111111',
        collageUrl: 'grace-booth-media://asset/collage-1',
        qrImageUrl: 'data:image/png;base64,mockqr',
        expiresAt: Date.now() + 30_000,
        durationSeconds: 45,
        queuedCount: 2,
        message: null,
        canRetryUpload: false,
      },
    });

    render(<QrStationScreen />);

    await waitFor(() => {
      expect(screen.getByTestId('qr-station-active')).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.getByText(/next photo replaces this in 30s/i)).toBeInTheDocument();
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
        queuedCount: 0,
        message: null,
        canRetryUpload: false,
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
});
