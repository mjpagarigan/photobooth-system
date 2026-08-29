import {
  EyeIcon as Eye,
  EyeSlashIcon as EyeSlash,
  LockKeyIcon as LockKey,
  XIcon as X,
} from '@phosphor-icons/react';
import { useRef, useState } from 'react';

import {
  Button,
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  Form,
  Input,
} from '@grace-booth/ui';

type PasscodeDialogProps = {
  busy?: boolean;
  dismissible?: boolean;
  error?: string | null;
  mode: 'login' | 'bootstrap' | 'restart';
  onCancel: () => void;
  onSubmit: (passcode: string) => void;
};

const MIN_PASSCODE_LENGTH = 8;

export function PasscodeDialog({
  busy = false,
  dismissible = true,
  error,
  mode,
  onCancel,
  onSubmit,
}: PasscodeDialogProps) {
  const [passcode, setPasscode] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [showPasscode, setShowPasscode] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const openerRef = useRef<HTMLElement | null>(
    typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null,
  );
  const isBootstrap = mode === 'bootstrap';

  const title = isBootstrap
    ? 'Create operator passcode'
    : mode === 'restart'
      ? 'Operator restart'
      : 'Operator access';

  const description = isBootstrap
    ? 'Create a shared passcode with at least 8 characters.'
    : mode === 'restart'
      ? 'Enter the operator passcode to restart this session safely.'
      : 'Enter the shared operator passcode.';

  const submit = (event?: React.SyntheticEvent) => {
    event?.preventDefault();
    setLocalError(null);

    if (passcode.length < MIN_PASSCODE_LENGTH) {
      setLocalError('Passcode must contain at least 8 characters.');
      return;
    }

    if (isBootstrap && passcode !== confirmation) {
      setLocalError('Passcodes do not match.');
      return;
    }

    onSubmit(passcode);
  };

  const displayedError = localError ?? error;

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open && dismissible && !busy) onCancel();
      }}
      open
    >
      <DialogPopup
        className="passcode-dialog"
        finalFocus={() => openerRef.current}
        maxWidthClass="max-w-md"
        showCloseButton={false}
      >
        <DialogHeader className="passcode-dialog__header">
          <div className="passcode-dialog__motif">
            <LockKey aria-hidden="true" weight="bold" />
          </div>
          <div>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </div>
          {dismissible ? (
            <DialogClose
              disabled={busy}
              render={
                <Button
                  aria-label="Close"
                  className="passcode-dialog__close"
                  size="icon"
                  type="button"
                  variant="ghost"
                />
              }
            >
              <X aria-hidden="true" weight="bold" />
            </DialogClose>
          ) : null}
        </DialogHeader>
        <Form className="contents" noValidate onSubmit={submit}>
          <DialogPanel className="passcode-dialog__form">
            <Field invalid={Boolean(displayedError)} name="passcode">
              <FieldLabel>Passcode</FieldLabel>
              <div className="password-field">
                <Input
                  aria-invalid={Boolean(displayedError)}
                  autoComplete={isBootstrap ? 'new-password' : 'current-password'}
                  autoFocus
                  id="operator-passcode"
                  maxLength={64}
                  minLength={MIN_PASSCODE_LENGTH}
                  onChange={(event) => setPasscode(event.target.value)}
                  required
                  type={showPasscode ? 'text' : 'password'}
                  value={passcode}
                />
                <Button
                  aria-label={showPasscode ? 'Hide passcode' : 'Show passcode'}
                  className="password-field__toggle"
                  onClick={() => setShowPasscode((visible) => !visible)}
                  size="icon"
                  type="button"
                  variant="ghost"
                >
                  {showPasscode ? (
                    <EyeSlash aria-hidden="true" weight="bold" />
                  ) : (
                    <Eye aria-hidden="true" weight="bold" />
                  )}
                </Button>
              </div>
              <FieldDescription>Use at least {MIN_PASSCODE_LENGTH} characters.</FieldDescription>
              {displayedError ? <FieldError match>{displayedError}</FieldError> : null}
            </Field>
            {isBootstrap ? (
              <Field name="confirmation">
                <FieldLabel>Confirm passcode</FieldLabel>
                <Input
                  autoComplete="new-password"
                  id="operator-passcode-confirmation"
                  maxLength={64}
                  minLength={MIN_PASSCODE_LENGTH}
                  onChange={(event) => setConfirmation(event.target.value)}
                  required
                  type={showPasscode ? 'text' : 'password'}
                  value={confirmation}
                />
              </Field>
            ) : null}
          </DialogPanel>
          <DialogFooter className="passcode-dialog__actions">
            {dismissible ? (
              <DialogClose
                disabled={busy}
                render={<Button type="button" variant="secondary" />}
              >
                Cancel
              </DialogClose>
            ) : null}
            <Button loading={busy} type="submit">
              {mode === 'restart' ? 'Restart session' : isBootstrap ? 'Save passcode' : 'Unlock'}
            </Button>
          </DialogFooter>
        </Form>
      </DialogPopup>
    </Dialog>
  );
}
