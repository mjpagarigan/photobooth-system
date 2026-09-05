import { Aperture, Camera, CheckCircle, Gear, Images, LockKey } from '@grace-booth/ui';
import { useEffect, useRef } from 'react';

import { Button } from '../components/Button';
import { LOCAL_FIXTURES } from '../local-fixtures';

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
    startButtonRef.current?.focus();
  }, []);

  return (
    <main className="screen screen--attract" data-testid="attract-screen">
      <img
        className="attract-background"
        src={LOCAL_FIXTURES.attractBackground}
        alt=""
        aria-hidden="true"
        draggable="false"
      />
      <div className="attract-scrim" aria-hidden="true" />
      <div className="attract-top-controls">
        {onOpenRecent && (
          <button
            className="operator-access recent-access"
            onClick={onOpenRecent}
            disabled={busy}
            aria-label="Recent Photos"
            title="Recent Photos"
            type="button"
          >
            <Images aria-hidden="true" weight="bold" />
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
            <Gear aria-hidden="true" weight="bold" />
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
          <LockKey aria-hidden="true" weight="bold" />
          <span className="operator-access__text">Admin</span>
        </button>
      </div>

      <section className="attract-card" aria-labelledby="attract-title">
        <div className="attract-card__brand-header">
          <div className="attract-card__motif" aria-hidden="true">
            <Aperture weight="bold" />
          </div>
        </div>

        <h1 id="attract-title">M.A.T. Photobooth</h1>
        <p className="attract-card__subtitle">Capture your moment</p>
        <p className="attract-card__lead">
          Take {shotCount} {shotCount === 1 ? 'photo' : 'photos'}, receive your finished collage, and scan to download instantly.
        </p>

        <p className="attract-status" role="status">
          <CheckCircle aria-hidden="true" weight="bold" />
          <span>{shotCount} {shotCount === 1 ? 'photo' : 'photos'} · custom collage · instant private download</span>
        </p>

        <Button
          className="button--attract-start"
          icon={<Camera aria-hidden="true" weight="bold" />}
          loading={busy}
          disabled={!canStart}
          onClick={onStart}
          ref={startButtonRef}
        >
          Start photo session
        </Button>

        {cameraMessage ? (
          <p className="attract-camera-message" role="alert">
            {cameraMessage}
          </p>
        ) : null}
      </section>
    </main>
  );
}
