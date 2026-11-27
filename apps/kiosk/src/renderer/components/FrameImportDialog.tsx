import { useState } from 'react';

import type { FrameImportCandidate } from '@grace-booth/shared';
import {
  Button,
  Dialog,
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

type FrameImportDialogProps = {
  busy: boolean;
  candidate: FrameImportCandidate;
  onCancel: () => void;
  onConfirm: (name: string, shotCount: number) => void;
};

function parseShotCount(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 10) return null;
  return parsed;
}

export function FrameImportDialog({ busy, candidate, onCancel, onConfirm }: FrameImportDialogProps) {
  const [name, setName] = useState(candidate.suggestedName);
  const [shotCountInput, setShotCountInput] = useState('3');
  const aspect = candidate.width / candidate.height;

  const trimmedName = name.trim();
  const parsedShotCount = parseShotCount(shotCountInput);
  const nameError = trimmedName.length === 0 ? 'Enter a frame name.' : null;
  const shotCountError =
    parsedShotCount === null ? 'Enter a whole number between 1 and 10.' : null;

  return (
    <Dialog
      open
      onOpenChange={(open, eventDetails) => {
        if (!open && !busy && eventDetails.reason !== 'close-press') onCancel();
      }}
    >
      <DialogPopup maxWidthClass="max-w-md" onClose={onCancel} showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle>Add frame</DialogTitle>
          <DialogDescription>
            Detected {candidate.width} × {candidate.height}px · {aspect.toFixed(3)}:1 aspect ratio
          </DialogDescription>
        </DialogHeader>
        <Form
          className="contents"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (trimmedName && parsedShotCount !== null) {
              onConfirm(trimmedName, parsedShotCount);
            }
          }}
        >
          <DialogPanel className="frame-import-dialog__form">
            <Field invalid={nameError !== null} name="frame-name">
              <FieldLabel>Frame name</FieldLabel>
              <Input
                aria-invalid={nameError !== null}
                autoFocus
                maxLength={120}
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
              {nameError ? (
                <FieldError match role="alert">
                  {nameError}
                </FieldError>
              ) : null}
            </Field>
            <Field invalid={shotCountError !== null} name="frame-shot-count">
              <FieldLabel>Shots / slots</FieldLabel>
              <Input
                aria-invalid={shotCountError !== null}
                inputMode="numeric"
                min="1"
                max="10"
                required
                step="1"
                type="number"
                value={shotCountInput}
                onChange={(event) => setShotCountInput(event.target.value)}
              />
              <FieldDescription>
                An orientation-aware starter grid will be generated and remains fully editable.
              </FieldDescription>
              {shotCountError ? (
                <FieldError match role="alert">
                  {shotCountError}
                </FieldError>
              ) : null}
            </Field>
          </DialogPanel>
          <DialogFooter>
            <Button disabled={busy} onClick={onCancel} type="button" variant="secondary">
              Cancel
            </Button>
            <Button
              disabled={nameError !== null || shotCountError !== null}
              loading={busy}
              type="submit"
            >
              Add frame
            </Button>
          </DialogFooter>
        </Form>
      </DialogPopup>
    </Dialog>
  );
}
