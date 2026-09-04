import { CheckCircle } from '@grace-booth/ui';

import { ProgressStepper } from '../components/ProgressStepper';
import { mockPhotoFor } from '../local-fixtures';

type CaptureScreenProps = {
  phase: 'countdown' | 'capturing';
  secondsRemaining: number;
  shotNumber: number;
  liveVideoRef?: (element: HTMLVideoElement | null) => void;
  liveStreamReady?: boolean;
};

const POSE_COPY = [
  'Made to Serve · Warm smiles & eyes on lens!',
  'Discover Your Gift · Fun & playful pose!',
  'Celebrate Together · Grand celebratory finale!',
] as const;

export function CaptureScreen({
  phase,
  secondsRemaining,
  shotNumber,
  liveVideoRef,
  liveStreamReady = false,
}: CaptureScreenProps) {
  const safeShot = Math.max(1, Math.min(3, shotNumber));
  const poseSuggestion = POSE_COPY[safeShot - 1];
  const countdownHint = secondsRemaining <= 3 ? 'Hold your pose' : 'Get ready';

  return (
    <main className="screen screen--capture" data-phase={phase} data-testid="capture-screen">
      <header className="capture-header">
        <ProgressStepper activeStep={safeShot} />
        <div className="camera-ready-badge" role="status">
          <CheckCircle aria-hidden="true" weight="bold" />
          <span>{liveVideoRef && !liveStreamReady ? 'Getting camera ready…' : 'Camera ready'}</span>
        </div>
      </header>
      <section className="viewfinder" aria-labelledby="capture-title">
        {liveVideoRef ? (
          <video
            className="viewfinder__live"
            ref={liveVideoRef}
            autoPlay
            muted
            playsInline
            aria-label="Live camera preview"
            data-testid="viewfinder-live"
            hidden={!liveStreamReady}
          />
        ) : null}
        {liveStreamReady ? null : (
          <div
            className="viewfinder__fixture"
            style={{ backgroundImage: `url(${mockPhotoFor(safeShot)})` }}
            role="img"
            aria-label="Local pose guide showing a family facing the camera"
          />
        )}
        <div className="viewfinder__scrim" aria-hidden="true" />
        <div className="viewfinder__pose-copy">
          <span>{poseSuggestion}</span>
        </div>
        {phase === 'countdown' ? (
          <div className="countdown-card">
            <span
              className="countdown-card__number"
              data-testid="countdown-value"
              role="timer"
              aria-label={`${secondsRemaining} seconds until photo ${safeShot}`}
            >
              {secondsRemaining}
            </span>
            <h1
              className="sr-only"
              id="capture-title"
              data-screen-heading
              tabIndex={-1}
            >
              {countdownHint}
            </h1>
          </div>
        ) : (
          <div
            className="countdown-card countdown-card--capturing"
            role="status"
            aria-live="polite"
          >
            <h1 id="capture-title" data-screen-heading tabIndex={-1} className="sr-only">
              Taking photo
            </h1>
          </div>
        )}
        <div
          className={`shutter-flash${phase === 'capturing' ? ' is-active' : ''}`}
          aria-hidden="true"
        />
      </section>
    </main>
  );
}
