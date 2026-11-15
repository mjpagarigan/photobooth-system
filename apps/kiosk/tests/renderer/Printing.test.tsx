// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest';

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AdminSettings, PrinterHealth } from '@grace-booth/shared';

import { PrinterIndicator } from '../../src/renderer/components/Printing';
import { DEFAULT_FRAME_LAYOUT, LOCAL_FIXTURES } from '../../src/renderer/local-fixtures';
import { ReviewScreen } from '../../src/renderer/screens/ReviewScreen';

const STRIP_FRAME = {
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Classic strip',
  width: 1200,
  height: 3600,
  byteSize: 44_090,
  mediaUrl: LOCAL_FIXTURES.matFrame,
  revision: 1,
  slots: DEFAULT_FRAME_LAYOUT,
} satisfies AdminSettings['activeFrame'];

const FOUR_R_FRAME = {
  ...STRIP_FRAME,
  id: '33333333-3333-4333-8333-333333333333',
  name: 'Landscape 4R',
  width: 3600,
  height: 2400,
};

function health(
  status: PrinterHealth['status'],
  extra: Partial<PrinterHealth> = {},
): PrinterHealth {
  return {
    status,
    printerName: 'EPSON L3210 Series',
    message: status === 'offline' ? 'Printer is offline or disconnected.' : 'Printer is ready.',
    queuedCount: 0,
    attentionCount: 0,
    checkedAt: 1,
    ...extra,
  };
}

afterEach(() => cleanup());

const captureUrls = ['/one.jpg', '/two.jpg', '/three.jpg'];

describe('review print controls', () => {
  it('shows print controls only for a landscape 4R frame, off by default', async () => {
    const user = userEvent.setup();
    const onAccept = vi.fn();
    render(
      <ReviewScreen
        canAccept
        canRetake
        captureUrls={captureUrls}
        frames={[STRIP_FRAME, FOUR_R_FRAME]}
        printerHealth={health('ready')}
        onAccept={onAccept}
        onRetake={() => undefined}
      />,
    );
    expect(screen.queryByTestId('review-print')).not.toBeInTheDocument();

    await user.click(screen.getByTestId('collage-option-2'));
    expect(screen.getByTestId('review-print')).toBeVisible();
    expect(screen.getByRole('switch', { name: /print this photo/i })).not.toBeChecked();

    await user.click(screen.getByRole('button', { name: /use these photos/i }));
    expect(onAccept).toHaveBeenLastCalledWith(FOUR_R_FRAME.id, null);
  });

  it('sends the copy count when printing is on and the printer is ready', async () => {
    const user = userEvent.setup();
    const onAccept = vi.fn();
    render(
      <ReviewScreen
        canAccept
        canRetake
        captureUrls={captureUrls}
        frames={[FOUR_R_FRAME]}
        printerHealth={health('ready')}
        onAccept={onAccept}
        onRetake={() => undefined}
      />,
    );
    await user.click(screen.getByRole('switch', { name: /print this photo/i }));
    await user.click(screen.getByRole('button', { name: /more copies/i }));
    await user.click(screen.getByRole('button', { name: /more copies/i }));
    expect(screen.getByTestId('copy-count')).toHaveValue(3);
    await user.click(screen.getByRole('button', { name: /use these photos/i }));
    expect(onAccept).toHaveBeenCalledWith(FOUR_R_FRAME.id, { copies: 3 });
  });

  it('turns printing off when the operator switches to a 1:3 frame', async () => {
    const user = userEvent.setup();
    const onAccept = vi.fn();
    render(
      <ReviewScreen
        canAccept
        canRetake
        captureUrls={captureUrls}
        frames={[FOUR_R_FRAME, STRIP_FRAME]}
        printerHealth={health('ready')}
        onAccept={onAccept}
        onRetake={() => undefined}
      />,
    );
    await user.click(screen.getByRole('switch', { name: /print this photo/i }));
    await user.click(screen.getByTestId('collage-option-2'));
    expect(screen.queryByTestId('review-print')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /use these photos/i }));
    expect(onAccept).toHaveBeenCalledWith(STRIP_FRAME.id, null);
  });

  it('warns when the printer is offline and Proceed queues the print anyway', async () => {
    const user = userEvent.setup();
    const onAccept = vi.fn();
    render(
      <ReviewScreen
        canAccept
        canRetake
        captureUrls={captureUrls}
        frames={[FOUR_R_FRAME]}
        printerHealth={health('offline')}
        onAccept={onAccept}
        onRetake={() => undefined}
      />,
    );
    await user.click(screen.getByRole('switch', { name: /print this photo/i }));
    await user.click(screen.getByRole('button', { name: /use these photos/i }));
    expect(onAccept).not.toHaveBeenCalled();
    expect(screen.getByTestId('review-printer-warning')).toHaveTextContent(/offline/i);

    await user.click(screen.getByTestId('print-proceed'));
    expect(onAccept).toHaveBeenCalledWith(FOUR_R_FRAME.id, { copies: 1 });
  });

  it('hides print controls entirely when printing is unavailable', () => {
    render(
      <ReviewScreen
        canAccept
        canRetake
        captureUrls={captureUrls}
        frames={[FOUR_R_FRAME]}
        onAccept={() => undefined}
        onRetake={() => undefined}
      />,
    );
    expect(screen.queryByTestId('review-print')).not.toBeInTheDocument();
  });
});

describe('printer indicator', () => {
  it('stays hidden while the printer is fine or not set up', () => {
    const { rerender } = render(<PrinterIndicator health={health('ready')} />);
    expect(screen.queryByTestId('printer-indicator')).not.toBeInTheDocument();
    rerender(<PrinterIndicator health={health('unconfigured')} />);
    expect(screen.queryByTestId('printer-indicator')).not.toBeInTheDocument();
  });

  it('shows the problem and the waiting count', () => {
    render(
      <PrinterIndicator health={health('paper_out', { queuedCount: 2, message: 'Load paper.' })} />,
    );
    const indicator = screen.getByTestId('printer-indicator');
    expect(indicator).toHaveTextContent('Printer out of paper · 2 copies waiting');
    expect(indicator).toHaveTextContent('Load paper.');
  });

  it('shows copies that need an operator decision even when the printer is ready', () => {
    render(<PrinterIndicator health={health('ready', { attentionCount: 1 })} />);
    expect(screen.getByTestId('printer-indicator')).toHaveTextContent('1 needs a decision');
  });
});
