// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { QrStationScreen } from '../../src/renderer/screens/QrStationScreen';

describe('QrStationScreen', () => {
  let mockBridge: any;

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
        subscribe: vi.fn().mockReturnValue(() => {}),
      },
      gallery: {
        getRecent: vi.fn().mockResolvedValue({
          ok: true,
          data: [],
        }),
      },
    };
    (window as any).graceBooth = mockBridge;
  });

  afterEach(() => {
    cleanup();
    delete (window as any).graceBooth;
  });

  it('renders idle screen with background and recent button when status is idle', async () => {
    render(<QrStationScreen />);

    await waitFor(() => {
      expect(screen.getByTestId('qr-station-idle')).toBeInTheDocument();
    });

    const recentButton = screen.getByRole('button', { name: /recent photos/i });
    expect(recentButton).toBeInTheDocument();
    expect(screen.queryByText(/scan to download/i)).not.toBeInTheDocument();
  });

  it('renders active QR screen with collage, QR code and countdown timer', async () => {
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
      },
    });

    render(<QrStationScreen />);

    await waitFor(() => {
      expect(screen.getByTestId('qr-station-active')).toBeInTheDocument();
    });

    expect(screen.getByText(/scan to download/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /done/i })).toBeInTheDocument();
    expect(screen.getByAltText(/qr code for photo download/i)).toBeInTheDocument();
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
      },
    });

    render(<QrStationScreen />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /done/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /done/i }));
    expect(mockBridge.qrStation.dismiss).toHaveBeenCalledTimes(1);
  });
});
