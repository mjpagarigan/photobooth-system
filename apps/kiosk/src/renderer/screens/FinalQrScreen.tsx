import { Images } from '@grace-booth/ui';
import { useEffect, useRef } from 'react';

import { Photostrip } from '../components/Photostrip';
import { QrPanel } from '../components/QrPanel';
import { LOCAL_FIXTURES } from '../local-fixtures';

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
  const resultRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const heading = document.querySelector<HTMLElement>('[data-screen-heading]');
    heading?.focus();
  }, []);

  return (
    <main className="screen screen--final" data-testid="final-screen">
      <img
        className="final-background"
        src={LOCAL_FIXTURES.finalBackground}
        alt=""
        aria-hidden="true"
        draggable="false"
      />
      <div className="final-scrim" aria-hidden="true" />
      {onOpenRecent && (
        <div className="final-top-controls">
          <button
            className="operator-access recent-access"
            onClick={onOpenRecent}
            disabled={busy}
            aria-label="Recent Photos"
            title="Recent Photos"
          >
            <Images aria-hidden="true" weight="bold" />
            <span className="operator-access__text">Recent</span>
          </button>
        </div>
      )}
      <div className="final-composition">
        <section className="final-result" aria-label="Your finished photo" ref={resultRef}>
          <Photostrip collageUrl={collageUrl} label="Your finished photo" variant="collage" />
        </section>
        <QrPanel busy={busy} onDone={onDone} qrImageUrl={qrImageUrl} />
      </div>
    </main>
  );
}
