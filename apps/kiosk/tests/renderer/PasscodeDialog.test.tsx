// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest';

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useState } from 'react';

import { PasscodeDialog } from '../../src/renderer/components/PasscodeDialog';

afterEach(cleanup);

function DialogHarness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Open operator access</button>
      {open ? (
        <PasscodeDialog mode="login" onCancel={() => setOpen(false)} onSubmit={() => undefined} />
      ) : null}
    </>
  );
}

describe('PasscodeDialog keyboard behavior', () => {
  it('wraps Tab and Shift+Tab inside the modal', async () => {
    const user = userEvent.setup();
    render(<DialogHarness />);
    await user.click(screen.getByRole('button', { name: /open operator access/i }));

    const close = screen.getByRole('button', { name: 'Close' });
    const unlock = screen.getByRole('button', { name: 'Unlock' });
    unlock.focus();
    await user.tab();
    expect(close).toHaveFocus();

    await user.tab({ shift: true });
    expect(unlock).toHaveFocus();
  });

  it('closes with Escape and restores the opener focus', async () => {
    const user = userEvent.setup();
    render(<DialogHarness />);
    const opener = screen.getByRole('button', { name: /open operator access/i });
    await user.click(opener);
    expect(screen.getByLabelText('Passcode')).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it('guards Close and Escape while an authentication request is busy', async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(<PasscodeDialog busy mode="login" onCancel={onCancel} onSubmit={() => undefined} />);

    expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled();
    await user.keyboard('{Escape}');
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('cannot dismiss the required first-run bootstrap', async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(
      <PasscodeDialog
        dismissible={false}
        mode="bootstrap"
        onCancel={onCancel}
        onSubmit={() => undefined}
      />,
    );

    expect(screen.queryByRole('button', { name: /cancel|close/i })).not.toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeVisible();
  });

  it('enforces the shared 8 to 64 character input boundary', () => {
    render(<PasscodeDialog mode="login" onCancel={() => undefined} onSubmit={() => undefined} />);
    const input = screen.getByLabelText('Passcode');
    expect(input).toHaveAttribute('minLength', '8');
    expect(input).toHaveAttribute('maxLength', '64');
  });
});
