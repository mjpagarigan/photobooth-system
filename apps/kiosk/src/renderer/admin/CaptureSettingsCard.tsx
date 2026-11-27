import {
  Button,
  Camera,
  CheckCircle,
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  Form,
  Input,
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from '@grace-booth/ui';
import { useState } from 'react';

import type {
  CaptureReviewMode,
  CaptureSettings,
  FrameSummary,
  SaveCaptureSettingsInput,
} from '@grace-booth/shared';
import { MAX_CAPTURE_COUNTDOWN_SECONDS, MIN_CAPTURE_COUNTDOWN_SECONDS } from '@grace-booth/shared';

const REVIEW_MODE_ITEMS: readonly { label: string; value: CaptureReviewMode }[] = [
  { label: 'Review every photo (Recommended)', value: 'per_shot' },
  { label: 'Continuous shooting', value: 'continuous' },
];

function parseCountdownSeconds(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) {
    return null;
  }
  const parsed = Number(trimmed);
  if (
    !Number.isInteger(parsed) ||
    parsed < MIN_CAPTURE_COUNTDOWN_SECONDS ||
    parsed > MAX_CAPTURE_COUNTDOWN_SECONDS
  ) {
    return null;
  }
  return parsed;
}

type CaptureSettingsCardProps = {
  activeFrame: FrameSummary;
  busy?: boolean;
  capture: CaptureSettings;
  onOpenFrameEditor?: (() => void) | undefined;
  onSave: (input: SaveCaptureSettingsInput) => void;
  revision: number;
};

export function CaptureSettingsCard({
  activeFrame,
  busy = false,
  capture,
  onOpenFrameEditor,
  onSave,
  revision,
}: CaptureSettingsCardProps) {
  const [reviewMode, setReviewMode] = useState<CaptureReviewMode>(capture.reviewMode);
  const [countdownInput, setCountdownInput] = useState<string>(String(capture.countdownSeconds));
  const [syncedRevision, setSyncedRevision] = useState<number>(revision);

  if (syncedRevision !== revision) {
    setSyncedRevision(revision);
    setReviewMode(capture.reviewMode);
    setCountdownInput(String(capture.countdownSeconds));
  }

  const parsedCountdown = parseCountdownSeconds(countdownInput);
  const countdownError =
    parsedCountdown === null
      ? `Enter a whole number between ${MIN_CAPTURE_COUNTDOWN_SECONDS} and ${MAX_CAPTURE_COUNTDOWN_SECONDS} seconds.`
      : null;

  const dirty = reviewMode !== capture.reviewMode || parsedCountdown !== capture.countdownSeconds;
  const slotCount = activeFrame.slots.length;
  const activeFrameSummary = `${activeFrame.name} (${slotCount} ${slotCount === 1 ? 'slot' : 'slots'})`;

  const handleSubmit = (event: React.SyntheticEvent) => {
    event.preventDefault();
    if (parsedCountdown === null || !dirty || busy) {
      return;
    }
    onSave({
      countdownSeconds: parsedCountdown,
      reviewMode,
      expectedRevision: revision,
    });
  };

  return (
    <Form
      className="settings-card settings-form"
      data-testid="capture-settings"
      noValidate
      onSubmit={handleSubmit}
    >
      <div className="settings-card__title">
        <Camera aria-hidden="true" weight="bold" />
        <div>
          <h3>Capture pacing &amp; photo review</h3>
          <p>
            Choose whether guests review each shot before moving on and how long each countdown
            runs.
          </p>
        </div>
      </div>

      <div className="capture-frame-row">
        <div className="capture-frame-row__text">
          <span className="capture-frame-row__label">Active frame</span>
          <strong className="capture-frame-row__value" data-testid="capture-active-frame">
            {activeFrameSummary}
          </strong>
        </div>
        {onOpenFrameEditor ? (
          <Button
            data-testid="open-frame-editor-from-capture"
            disabled={busy}
            onClick={onOpenFrameEditor}
            type="button"
            variant="secondary"
          >
            Frame editor
          </Button>
        ) : null}
      </div>

      <Field name="capture-review-mode">
        <FieldLabel>Shot review mode</FieldLabel>
        <Select
          items={REVIEW_MODE_ITEMS}
          value={reviewMode}
          onValueChange={(value) => {
            if (value === 'per_shot' || value === 'continuous') {
              setReviewMode(value);
            }
          }}
        >
          <SelectTrigger aria-label="Shot review mode" data-testid="capture-review-mode">
            <SelectValue />
          </SelectTrigger>
          <SelectPopup>
            {REVIEW_MODE_ITEMS.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
        <FieldDescription>
          {reviewMode === 'per_shot'
            ? 'Pauses after every capture so guests can retake that slot or continue to the next photo.'
            : 'Takes every slot back-to-back automatically, then shows all photos together at the end.'}
        </FieldDescription>
      </Field>

      <Field invalid={countdownError !== null} name="capture-countdown-seconds">
        <FieldLabel>Countdown per photo (seconds)</FieldLabel>
        <Input
          aria-invalid={countdownError !== null}
          data-testid="capture-countdown-seconds"
          inputMode="numeric"
          max={MAX_CAPTURE_COUNTDOWN_SECONDS}
          min={MIN_CAPTURE_COUNTDOWN_SECONDS}
          onChange={(event) => setCountdownInput(event.target.value)}
          step={1}
          type="number"
          value={countdownInput}
        />
        <FieldDescription>
          Whole seconds from {MIN_CAPTURE_COUNTDOWN_SECONDS} to {MAX_CAPTURE_COUNTDOWN_SECONDS}{' '}
          before each capture. Changes apply to new sessions.
        </FieldDescription>
        {countdownError ? (
          <FieldError match role="alert">
            {countdownError}
          </FieldError>
        ) : null}
      </Field>

      <Button
        data-testid="save-capture-settings"
        disabled={!dirty || busy || parsedCountdown === null}
        icon={<CheckCircle aria-hidden="true" weight="bold" />}
        loading={busy}
        type="submit"
      >
        Save capture settings
      </Button>
    </Form>
  );
}
