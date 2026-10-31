import { LockKey } from '@grace-booth/ui';
import { useEffect } from 'react';

import { Button } from '../components/Button';
import { Photostrip } from '../components/Photostrip';

type FinalQrScreenProps = {
  busy?: boolean;
  collageUrl: string;
  onDone: () => void;
  onOpenRecent?: () => void;
  qrImageUrl: string;
};

export function FinalQrScreen({
  busy = false,
  collageUrl,
  onDone,
  onOpenRecent,
  qrImageUrl,
}: FinalQrScreenProps) {
  useEffect(() => {
    const heading = document.querySelector<HTMLElement>('[data-screen-heading]');
    heading?.focus();
  }, []);

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
            <p className="final-keepsake__eyebrow">Ready to download</p>
            <h2>Available for 30 days</h2>
            <p className="final-keepsake__private">
              <LockKey aria-hidden="true" />
              Private link, just for you
            </p>
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
