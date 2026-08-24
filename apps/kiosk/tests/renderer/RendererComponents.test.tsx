// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AdminHealth, AdminSettings, FrameLayout } from '@grace-booth/shared';

import { AdminSettings as AdminSettingsScreen } from '../../src/renderer/admin/AdminSettings';
import { FrameEditor } from '../../src/renderer/admin/FrameEditor';
import { CaptureScreen } from '../../src/renderer/screens/CaptureScreen';
import { ProcessingScreen } from '../../src/renderer/screens/ProcessingScreen';
import { RecoveryScreen } from '../../src/renderer/screens/RecoveryScreen';
import { ReviewScreen } from '../../src/renderer/screens/ReviewScreen';
import {
  ANNIVERSARY_FRAME_LAYOUT,
  DEFAULT_FRAME_LAYOUT,
  LOCAL_FIXTURES,
} from '../../src/renderer/local-fixtures';
import { recoveryVariantFor, safeGuestMessage } from '../../src/renderer/types';

const FRAME = {
  id: '22222222-2222-4222-8222-222222222222',
  name: 'M.A.T. 42nd Anniversary',
  width: 1200,
  height: 3600,
  byteSize: 44_090,
  mediaUrl: LOCAL_FIXTURES.matFrame,
  revision: 1,
  slots: DEFAULT_FRAME_LAYOUT,
} satisfies AdminSettings['activeFrame'];

const FRAME_2 = {
  ...FRAME,
  id: '00000000-0000-4000-8000-000000000002',
  name: 'CCF Alabang 42nd Anniversary',
  mediaUrl: LOCAL_FIXTURES.annivFrame,
  slots: ANNIVERSARY_FRAME_LAYOUT,
} satisfies AdminSettings['activeFrame'];

const SETTINGS: AdminSettings = {
  googleFormsUrl: null,
  localRetentionDays: 60,
  cloudRetentionDays: 30,
  lan: {
    enabled: false,
    bindHost: '127.0.0.1',
    port: 4310,
    tlsConfigured: false,
    certificateFingerprint: null,
  },
  activeFrame: FRAME,
  frames: [FRAME, FRAME_2],
  cameraAdapter: 'webcam',
  cameraDeviceId: null,
  cameraResolution: '1080p',
  supabaseUrl: null,
  supabasePublishableKey: null,
  revision: 4,
};

const HEALTH: AdminHealth = {
  camera: { state: 'healthy', code: null, message: 'Camera ready.', checkedAt: 1 },
  cloud: { state: 'degraded', code: 'offline', message: 'Retrying.', checkedAt: 1 },
  database: { state: 'healthy', code: null, message: 'Database ready.', checkedAt: 1 },
  encryption: { state: 'healthy', code: null, message: 'Encryption ready.', checkedAt: 1 },
};

afterEach(cleanup);

describe('guest screen components', () => {
  it('renders the locked countdown progress and current pose', () => {
    render(<CaptureScreen phase="countdown" secondsRemaining={5} shotNumber={3} />);
    expect(screen.getByText('Photo 3 of 3')).toBeVisible();
    expect(screen.getByTestId('countdown-value')).toHaveTextContent('5');
    expect(screen.getByText(/Ministry Fair · Grand celebratory finale!/i)).toBeVisible();
  });

  it('renders only whole-set review actions across two collage options', async () => {
    const user = userEvent.setup();
    const captureUrls = ['/capture/one.jpg', '/capture/two.jpg', '/capture/three.jpg'];
    const onAccept = vi.fn();
    render(
      <ReviewScreen
        canAccept
        canRetake
        captureUrls={captureUrls}
        frames={[FRAME, FRAME_2]}
        onAccept={onAccept}
        onRetake={() => undefined}
      />,
    );
    expect(screen.getAllByRole('figure')).toHaveLength(6);
    expect(screen.getByTestId('collage-option-1')).toHaveClass('is-selected');
    expect(screen.getByTestId('collage-option-2')).not.toHaveClass('is-selected');

    await user.click(screen.getByTestId('collage-option-2'));
    expect(screen.getByTestId('collage-option-2')).toHaveClass('is-selected');
    expect(screen.getByTestId('collage-option-1')).not.toHaveClass('is-selected');

    await user.click(screen.getByRole('button', { name: /use these photos/i }));
    expect(onAccept).toHaveBeenCalledWith(FRAME_2.id);
    expect(screen.getAllByRole('button')).toHaveLength(2);
    expect(screen.queryByText(/retake photo 1/i)).not.toBeInTheDocument();
  });

  it('renders one preview per stored frame and supports keyboard-only walkthrough', async () => {
    const user = userEvent.setup();
    const onAccept = vi.fn();
    const third = {
      ...FRAME,
      id: '33333333-3333-4333-8333-333333333333',
      name: 'Summer Fair Strip',
    };
    const fiveFrames = [FRAME, FRAME_2, third];
    render(
      <ReviewScreen
        canAccept
        canRetake={false}
        captureUrls={['/a.jpg', '/b.jpg', '/c.jpg']}
        frames={fiveFrames}
        onAccept={onAccept}
        onRetake={() => undefined}
      />,
    );
    expect(screen.getByTestId('collage-option-1')).toBeVisible();
    expect(screen.getByTestId('collage-option-2')).toBeVisible();
    expect(screen.getByTestId('collage-option-3')).toBeVisible();
    expect(screen.getByTestId('collage-option-1')).toHaveClass('is-selected');
    expect(screen.queryByTestId('collage-option-4')).not.toBeInTheDocument();

    screen.getByTestId('collage-option-1').focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByTestId('collage-option-2')).toHaveClass('is-selected');
    await user.keyboard('{ArrowRight}');
    expect(screen.getByTestId('collage-option-3')).toHaveClass('is-selected');
    await user.keyboard('{Enter}');
    expect(screen.getByTestId('collage-option-3')).toHaveClass('is-selected');
    await user.click(screen.getByRole('button', { name: /use these photos/i }));
    expect(onAccept).toHaveBeenCalledWith(third.id);
  });

  it('distinguishes collage processing from upload backoff without claiming readiness', () => {
    const { rerender } = render(<ProcessingScreen state="processing" />);
    expect(screen.getByText('Creating your collage')).toBeVisible();
    expect(screen.getByText('Combining your three photos into one finished image.')).toBeVisible();
    expect(screen.getByTestId('processing-animation')).toBeVisible();
    expect(screen.queryByText('Photo ready')).not.toBeInTheDocument();

    rerender(<ProcessingScreen state="pending_upload" />);
    expect(screen.getByText('Your photo is safely saved')).toBeVisible();
    expect(screen.getByTestId('processing-screen')).toHaveAttribute('data-state', 'pending_upload');
  });

  it('exposes no recovery action while interrupted reconciliation runs', () => {
    render(
      <RecoveryScreen
        onOpenAdmin={() => undefined}
        onRestart={() => undefined}
        onRetryUpload={() => undefined}
        variant="interrupted"
      />,
    );
    expect(screen.getByTestId('recovery-interrupted')).toBeVisible();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('FrameEditor', () => {
  const baseProps = {
    onAddFrame: vi.fn(),
    onDeleteFrame: vi.fn(),
    onMoveFrame: vi.fn(),
    status: null,
  };

  it('saves edited slot geometry as normalized coordinates for the selected frame', async () => {
    const onSave =
      vi.fn<(frameId: string, name: string, slots: FrameLayout, revision: number) => void>();
    const user = userEvent.setup();
    render(<FrameEditor {...baseProps} frames={[FRAME]} onSave={onSave} />);

    fireEvent.change(screen.getByLabelText('x percent'), { target: { value: '12.5' } });
    await user.click(screen.getByRole('button', { name: /save configuration/i }));
    expect(onSave).toHaveBeenCalledOnce();
    expect(onSave.mock.calls[0]?.[0]).toBe(FRAME.id);
    const savedSlots = onSave.mock.calls[0]?.[2];
    expect(savedSlots).toBeDefined();
    expect(savedSlots?.[0]?.x).toBeCloseTo(0.125);
  });

  it('renames the selected frame and resets its slot geometry', async () => {
    const onSave =
      vi.fn<(frameId: string, name: string, slots: FrameLayout, revision: number) => void>();
    const user = userEvent.setup();
    render(<FrameEditor {...baseProps} frames={[FRAME, FRAME_2]} onSave={onSave} />);

    await user.click(screen.getByTestId('frame-item-2'));
    fireEvent.change(screen.getByLabelText('width percent'), { target: { value: '30' } });
    await user.click(screen.getByRole('button', { name: /reset slot/i }));
    expect(screen.getByLabelText('width percent')).toHaveValue(86);

    const nameInput = screen.getByLabelText('Frame name');
    fireEvent.change(nameInput, { target: { value: 'Renamed strip' } });
    await user.click(screen.getByRole('button', { name: /save configuration/i }));
    expect(onSave.mock.calls[0]?.[0]).toBe(FRAME_2.id);
    expect(onSave.mock.calls[0]?.[1]).toBe('Renamed strip');
  });

  it('adds, reorders, and requires confirmation before deleting frames', async () => {
    const onAddFrame = vi.fn();
    const onDeleteFrame = vi.fn();
    const onMoveFrame = vi.fn();
    const user = userEvent.setup();
    render(
      <FrameEditor
        busy={false}
        error={null}
        frames={[FRAME, FRAME_2]}
        onAddFrame={onAddFrame}
        onDeleteFrame={onDeleteFrame}
        onMoveFrame={onMoveFrame}
        onSave={() => undefined}
        status={null}
      />,
    );

    await user.click(screen.getByTestId('frame-add'));
    expect(onAddFrame).toHaveBeenCalledOnce();

    await user.click(screen.getByTestId('frame-item-1'));
    await user.click(screen.getByRole('button', { name: `Move ${FRAME.name} down` }));
    expect(onMoveFrame).toHaveBeenCalledWith(FRAME.id, 'down');

    await user.click(screen.getByRole('button', { name: `Delete ${FRAME.name}` }));
    expect(onDeleteFrame).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: `Confirm delete ${FRAME.name}` }));
    expect(onDeleteFrame).toHaveBeenCalledWith(FRAME.id);
  });

  it('deletes the clicked row even when a different frame is currently selected', async () => {
    const onDeleteFrame = vi.fn();
    const user = userEvent.setup();
    render(
      <FrameEditor
        {...baseProps}
        frames={[FRAME, FRAME_2]}
        onDeleteFrame={onDeleteFrame}
        onSave={() => undefined}
      />,
    );

    // Row 1 (FRAME) is selected by default. Click trash on Row 2 (FRAME_2).
    await user.click(screen.getByRole('button', { name: `Delete ${FRAME_2.name}` }));
    expect(onDeleteFrame).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: `Confirm delete ${FRAME_2.name}` }));
    expect(onDeleteFrame).toHaveBeenCalledWith(FRAME_2.id);
  });

  it('handles ReviewScreen with 1, 3, and 20 frames with roving tabindex and keyboard navigation', async () => {
    const user = userEvent.setup();
    const onAccept = vi.fn();

    // 1 Frame
    const { unmount: unmount1 } = render(
      <ReviewScreen
        canAccept
        canRetake={false}
        captureUrls={['/a.jpg', '/b.jpg', '/c.jpg']}
        frames={[FRAME]}
        onAccept={onAccept}
        onRetake={() => undefined}
      />,
    );
    expect(screen.getByTestId('collage-option-1')).toHaveAttribute('tabindex', '0');
    expect(screen.getByTestId('collage-option-1')).toHaveClass('is-selected');
    unmount1();

    // 20 Frames
    const twentyFrames = Array.from({ length: 20 }, (_, index) => ({
      ...FRAME,
      id: `frame-${index + 1}-0000-0000-0000-000000000000`,
      name: `Frame Variant ${index + 1}`,
    }));
    render(
      <ReviewScreen
        canAccept
        canRetake={false}
        captureUrls={['/a.jpg', '/b.jpg', '/c.jpg']}
        frames={twentyFrames}
        onAccept={onAccept}
        onRetake={() => undefined}
      />,
    );

    expect(screen.getByTestId('collage-option-1')).toHaveAttribute('tabindex', '0');
    expect(screen.getByTestId('collage-option-2')).toHaveAttribute('tabindex', '-1');
    expect(screen.getByTestId('collage-option-20')).toBeInTheDocument();

    screen.getByTestId('collage-option-1').focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByTestId('collage-option-2')).toHaveClass('is-selected');
    expect(screen.getByTestId('collage-option-2')).toHaveAttribute('tabindex', '0');
    expect(screen.getByTestId('collage-option-1')).toHaveAttribute('tabindex', '-1');
  });
});

describe('AdminSettings', () => {
  const props = {
    health: HEALTH,
    jobs: [],
    onChangePasscode: vi.fn(),
    onChooseLanCertificate: vi.fn(),
    onConnectCloud: vi.fn(),
    onRefresh: vi.fn(),
    onRetryJob: vi.fn(),
    onSaveSettings: vi.fn(),
    settings: SETTINGS,
  };

  it('validates LAN port range before saving', async () => {
    render(
      <AdminSettingsScreen
        {...props}
        settings={{ ...SETTINGS, lan: { ...SETTINGS.lan, enabled: true } }}
      />,
    );
    const portInput = screen.getByLabelText('Port');
    fireEvent.change(portInput, { target: { value: '80' } });
    fireEvent.submit(portInput.closest('form')!);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'LAN port must be between 1024 and 65535.',
    );
    expect(props.onSaveSettings).not.toHaveBeenCalled();
  });

  it('keeps retention read-only and passcode inputs aligned to 8 to 64 characters', () => {
    render(<AdminSettingsScreen {...props} />);
    expect(screen.getByText('30')).toBeVisible();
    expect(screen.getByText('60')).toBeVisible();
    expect(screen.queryByRole('spinbutton', { name: /retention/i })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Current passcode')).toHaveAttribute('maxLength', '64');
    expect(screen.getByLabelText('New passcode')).toHaveAttribute('maxLength', '64');
    expect(screen.getByLabelText('Confirm passcode')).toHaveAttribute('maxLength', '64');
  });
});

describe('guest-safe state helpers', () => {
  it('maps recovery variants deterministically', () => {
    expect(recoveryVariantFor('camera_error', null)).toBe('camera');
    expect(recoveryVariantFor('upload_failed', null)).toBe('upload');
    expect(recoveryVariantFor('interrupted', 'interrupted')).toBe('interrupted');
  });

  it('filters paths and credential-like technical messages from guest copy', () => {
    expect(safeGuestMessage('C:\\Users\\operator\\secret.jpg', 'Safe fallback')).toBe(
      'Safe fallback',
    );
    expect(safeGuestMessage('Bearer private-value', 'Safe fallback')).toBe('Safe fallback');
    expect(safeGuestMessage('Your photo is safe on this booth.', 'Safe fallback')).toBe(
      'Your photo is safe on this booth.',
    );
  });
});
