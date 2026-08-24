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
      <div className="final-composition">
        <section className="final-result" aria-label="Your finished photo" ref={resultRef}>
          <Photostrip
            collageUrl={collageUrl}
            label="Your finished three-photo strip"
            variant="collage"
          />
        </section>
        <QrPanel
          busy={busy}
          onDone={onDone}
          onOpenRecent={onOpenRecent}
          qrImageUrl={qrImageUrl}
        />
      </div>
    </main>
  );
}
