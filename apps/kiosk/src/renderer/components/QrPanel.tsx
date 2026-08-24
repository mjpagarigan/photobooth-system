import {
  CalendarBlankIcon as CalendarBlank,
  CheckCircleIcon as CheckCircle,
  ImagesIcon as Images,
} from '@phosphor-icons/react';

import { Button } from './Button';

type QrPanelProps = {
  qrImageUrl: string;
  onDone: () => void;
  onOpenRecent?: (() => void) | undefined;
  busy?: boolean | undefined;
};

export function QrPanel({ busy = false, onDone, onOpenRecent, qrImageUrl }: QrPanelProps) {
  return (
    <section className="qr-panel" aria-labelledby="qr-title">
      <div className="qr-panel__copy">
        <h1 id="qr-title" data-screen-heading tabIndex={-1}>
          All set!
        </h1>
        <p>Scan the QR code with your phone camera to download your collage.</p>
      </div>
      <div className="qr-panel__code">
        <img src={qrImageUrl} alt="QR code for your private photo download" draggable="false" />
      </div>
      <div className="qr-panel__notice">
        <CalendarBlank aria-hidden="true" weight="bold" />
        <span>Available for 30 days</span>
      </div>
      <div className="qr-panel__actions">
        <Button
          className="qr-panel__done"
          iconAfter={<CheckCircle aria-hidden="true" weight="bold" />}
          loading={busy}
          onClick={onDone}
          wide
        >
          Done
        </Button>
        {onOpenRecent ? (
          <Button
            className="qr-panel__recent"
            icon={<Images aria-hidden="true" weight="bold" />}
            onClick={onOpenRecent}
            variant="secondary"
            wide
          >
            Recent
          </Button>
        ) : null}
      </div>
    </section>
  );
}
