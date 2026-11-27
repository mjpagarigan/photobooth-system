import type {
  DeliveryMode,
  SessionPrintStatus as SessionPrintStatusData,
} from '@grace-booth/shared';
import { Button, LockKey, WifiHigh } from '@grace-booth/ui';
import { useEffect } from 'react';

import { Photostrip } from '../components/Photostrip';
import { SessionPrintStatus } from '../components/SessionPrintStatus';

export type FinalDeliveryMode = DeliveryMode;

type FinalDeliveryCopy = {
  eyebrow: string;
  heading: (cloudRetentionDays: number) => string;
  detail: string;
  icon: typeof LockKey;
};

const DELIVERY_COPY: Record<FinalDeliveryMode, FinalDeliveryCopy> = {
  cloud: {
    eyebrow: 'Ready to download',
    heading: (days) => `Available for ${days} days`,
    detail: 'Private link, just for you',
    icon: LockKey,
  },
  offline: {
    eyebrow: 'Local Wi-Fi',
    heading: () => 'Save on this network',
    detail: 'Connect your phone to the booth Wi-Fi, then scan',
    icon: WifiHigh,
  },
};

type FinalQrScreenProps = {
  busy?: boolean;
  cloudRetentionDays?: number;
  collageUrl: string;
  deliveryMode?: FinalDeliveryMode;
  onDone: () => void;
  onOpenRecent?: () => void;
  printStatus?: SessionPrintStatusData | null | undefined;
  qrImageUrl: string;
};

export function FinalQrScreen({
  busy = false,
  cloudRetentionDays = 30,
  collageUrl,
  deliveryMode = 'cloud',
  onDone,
  onOpenRecent,
  printStatus,
  qrImageUrl,
}: FinalQrScreenProps) {
  useEffect(() => {
    const heading = document.querySelector<HTMLElement>('[data-screen-heading]');
    heading?.focus();
  }, []);

  const copy = DELIVERY_COPY[deliveryMode];
  const DetailIcon = copy.icon;

  return (
    <main className="screen screen--done" data-testid="final-screen">
      <header className="final-hero">
        <h1 id="final-title" data-screen-heading tabIndex={-1}>
          You’re all set.
        </h1>
        <p>Scan the code with your phone camera to save your keepsake.</p>
        {onOpenRecent && (
          <button
            className="operator-access recent-access final-recent"
            onClick={onOpenRecent}
            disabled={busy}
            aria-label="Recent Photos"
            title="Recent Photos"
            type="button"
          >
            <span className="operator-access__text">Recent</span>
          </button>
        )}
      </header>

      <div className="final-body">
        <div className="final-keepsake">
          <section className="final-result" aria-label="Your finished photo">
            <Photostrip collageUrl={collageUrl} label="Your finished photo" variant="collage" />
          </section>
          <div className="final-keepsake__copy">
            <p className="final-keepsake__eyebrow">{copy.eyebrow}</p>
            <h2>{copy.heading(cloudRetentionDays)}</h2>
            <p className="final-keepsake__private">
              <DetailIcon aria-hidden="true" />
              {copy.detail}
            </p>
            <SessionPrintStatus status={printStatus} tone="light" />
          </div>
        </div>

        <div className="final-qr">
          <div className="final-qr__code">
            <img src={qrImageUrl} alt="QR code for your private photo download" draggable="false" />
          </div>
          <Button className="button--final-done" loading={busy} onClick={onDone}>
            Done
          </Button>
        </div>
      </div>
    </main>
  );
}
