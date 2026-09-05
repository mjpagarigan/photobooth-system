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

export function FrameImportDialog({ busy, candidate, onCancel, onConfirm }: FrameImportDialogProps) {
  const [name, setName] = useState(candidate.suggestedName);
  const [shotCount, setShotCount] = useState(3);
  const aspect = candidate.width / candidate.height;

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) onCancel(); }}>
      <DialogPopup maxWidthClass="max-w-md" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Add frame</DialogTitle>
          <DialogDescription>
            Detected {candidate.width} × {candidate.height}px · {aspect.toFixed(3)}:1 aspect ratio
          </DialogDescription>
        </DialogHeader>
        <Form
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim() && shotCount >= 1 && shotCount <= 10) onConfirm(name.trim(), shotCount);
          }}
        >
          <DialogPanel className="passcode-dialog__form">
            <Field name="frame-name">
              <FieldLabel>Frame name</FieldLabel>
              <Input autoFocus maxLength={120} required value={name} onChange={(event) => setName(event.target.value)} />
            </Field>
            <Field name="frame-shot-count">
              <FieldLabel>Shots / slots</FieldLabel>
              <Input
                min="1"
                max="10"
                required
                type="number"
                value={shotCount}
                onChange={(event) => setShotCount(Number(event.target.value))}
              />
              <FieldDescription>An orientation-aware starter grid will be generated and remains fully editable.</FieldDescription>
            </Field>
          </DialogPanel>
          <DialogFooter>
            <Button disabled={busy} onClick={onCancel} type="button" variant="secondary">Cancel</Button>
            <Button disabled={!name.trim() || shotCount < 1 || shotCount > 10} loading={busy} type="submit">Add frame</Button>
          </DialogFooter>
        </Form>
      </DialogPopup>
    </Dialog>
  );
}
