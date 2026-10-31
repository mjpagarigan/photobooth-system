import { useEffect, useRef } from 'react';

import { Button } from '../components/Button';

const SHOT_WORDS = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six'];

type AttractScreenProps = {
  busy?: boolean;
  cameraMessage?: string | null;
  canStart: boolean;
  onOpenAdmin: () => void;
  onOpenCameras?: () => void;
  onOpenRecent?: () => void;
  onStart: () => void;
  shotCount?: number;
};

export function AttractScreen({
  busy = false,
  cameraMessage = null,
  canStart,
  onOpenAdmin,
  onOpenCameras,
  onOpenRecent,
  onStart,
  shotCount = 3,
}: AttractScreenProps) {
  const startButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!canStart || busy) return;
    const active = document.activeElement;
    if (active === null || active === document.body) startButtonRef.current?.focus();
  }, [busy, canStart]);

  const shotWord = SHOT_WORDS[shotCount] ?? String(shotCount);

  return (
    <main className="screen screen--attract" data-testid="attract-screen">
      <header className="attract-bar">
        <span className="attract-bar__brand">M.A.T. Photobooth</span>
        <nav className="attract-bar__nav" aria-label="Booth controls">
          {onOpenRecent && (
            <button
              className="operator-access recent-access"
              onClick={onOpenRecent}
              disabled={busy}
              aria-label="Recent Photos"
              title="Recent Photos"
              type="button"
            >
              <span className="operator-access__text">Recent</span>
            </button>
          )}
          {onOpenCameras && (
            <button
              className="operator-access camera-access"
              onClick={onOpenCameras}
              disabled={busy}
              aria-label="Camera Setup"
              title="Camera Setup"
              type="button"
            >
              <span className="operator-access__text">Camera</span>
            </button>
          )}
          <button
            className="operator-access"
            onClick={onOpenAdmin}
            aria-label="Admin"
            title="Admin"
            disabled={busy}
            type="button"
          >
            <span className="operator-access__text">Admin</span>
          </button>
        </nav>
      </header>

      <section className="attract-hero" aria-labelledby="attract-title">
        <p className="attract-hero__eyebrow">M.A.T. Photobooth</p>
        <h1 id="attract-title">Hello, smile.</h1>
        <p className="attract-hero__lead">
          {shotWord} {shotCount === 1 ? 'photo' : 'photos'}. One keepsake.
        </p>
        <p className="attract-hero__sub">On your phone in seconds</p>

        <div className="attract-hero__actions">
          <Button
            className="button--attract-start"
            loading={busy}
            disabled={!canStart}
            onClick={onStart}
            ref={startButtonRef}
          >
            Start photo session
          </Button>
        </div>

        {cameraMessage ? (
          <p className="attract-camera-message" role="alert">
            {cameraMessage}
          </p>
        ) : null}

        <div className="attract-strips" aria-hidden="true">
          {(['left', 'center', 'right'] as const).map((side) => (
            <div key={side} className={`attract-strip attract-strip--${side}`}>
              <span />
              <span />
              <span />
            </div>
          ))}
        </div>
      </section>

      <footer className="attract-footer">
        Photos stay private. Scan the QR code at the end to download yours.
      </footer>
    </main>
  );
}
