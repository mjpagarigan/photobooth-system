import { CalendarBlank, CheckCircle } from '@grace-booth/ui';

import { Button } from './Button';

type QrPanelProps = {
  qrImageUrl: string;
  onDone: () => void;
  busy?: boolean | undefined;
  heading?: string;
};

export function QrPanel({
  busy = false,
  onDone,
  qrImageUrl,
  heading = 'Please scan the QR Code beside to download the photo',
}: QrPanelProps) {
  return (
    <section className="qr-panel" aria-labelledby="qr-title">
      <div className="qr-panel__copy">
        <h1 id="qr-title" data-screen-heading tabIndex={-1}>
          {heading}
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
      </div>
    </section>
  );
}
