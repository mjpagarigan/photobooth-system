import { CAMERA_ZOOM_DEFAULT } from '@grace-booth/shared';
import { Button } from '@grace-booth/ui';

import { posePromptForShot } from '../capture-helpers';
import { ProgressStepper } from '../components/ProgressStepper';
import { mockPhotoFor } from '../local-fixtures';

type CaptureScreenSharedProps = {
  shotNumber: number;
  totalShots?: number;
  liveVideoRef?: (element: HTMLVideoElement | null) => void;
  liveImageUrl?: string | null;
  liveStreamReady?: boolean;
  cameraZoomPercent?: number;
};

export type CaptureScreenProps =
  | (CaptureScreenSharedProps & {
      phase: 'countdown';
      secondsRemaining: number;
    })
  | (CaptureScreenSharedProps & {
      phase: 'capturing';
    })
  | (CaptureScreenSharedProps & {
      phase: 'shot_review';
      capturedPhotoUrl: string | null;
      captureUrls: readonly string[];
      busy?: boolean;
      canAcceptShot: boolean;
      canRetakeShot: boolean;
      errorMessage?: string | null;
      onAcceptShot: () => void;
      onRetakeShot: () => void;
    });

export function CaptureScreen(props: CaptureScreenProps) {
  const {
    phase,
    shotNumber,
    totalShots = 3,
    liveVideoRef,
    liveImageUrl,
    liveStreamReady = false,
    cameraZoomPercent = CAMERA_ZOOM_DEFAULT,
  } = props;

  const safeTotal = Math.max(1, Math.trunc(totalShots));
  const safeShot = Math.max(1, Math.min(safeTotal, Math.trunc(shotNumber)));
  const poseSuggestion = posePromptForShot(safeShot, safeTotal);

  return (
    <main
      className="screen screen--capture"
      data-phase={phase}
      data-testid={phase === 'shot_review' ? 'shot-review-screen' : 'capture-screen'}
    >
      <header className="capture-header">
        <div className="camera-ready-badge" role="status">
          {phase !== 'shot_review' &&
          (liveVideoRef || liveImageUrl !== undefined) &&
          !liveStreamReady
            ? 'Getting camera ready…'
            : null}
        </div>
        <ProgressStepper activeStep={safeShot} total={safeTotal} />
      </header>
      <section className="viewfinder" aria-labelledby="capture-title">
        {liveImageUrl ? (
          <img
            className="viewfinder__live"
            src={liveImageUrl}
            alt="Live camera preview"
            aria-hidden={phase === 'shot_review' ? true : undefined}
            data-testid="viewfinder-live"
            style={{ scale: cameraZoomPercent / 100 }}
            hidden={!liveStreamReady}
          />
        ) : liveVideoRef ? (
          <video
            className="viewfinder__live"
            ref={liveVideoRef}
            autoPlay
            muted
            playsInline
            aria-label="Live camera preview"
            aria-hidden={phase === 'shot_review' ? true : undefined}
            data-testid="viewfinder-live"
            style={{ scale: cameraZoomPercent / 100 }}
            hidden={!liveStreamReady}
          />
        ) : null}
        {liveStreamReady || phase === 'shot_review' ? null : (
          <div
            className="viewfinder__fixture"
            style={{ backgroundImage: `url(${mockPhotoFor(safeShot)})` }}
            role="img"
            aria-label="Local pose guide showing a family facing the camera"
          />
        )}
        {phase === 'shot_review' ? (
          <div className="viewfinder__shot-preview" data-testid="shot-review-preview">
            <div className="viewfinder__shot-stage">
              {props.capturedPhotoUrl ? (
                <img
                  src={props.capturedPhotoUrl}
                  alt={`Captured photo ${safeShot} of ${safeTotal}`}
                  className="viewfinder__shot-image"
                  data-testid="shot-review-image"
                  draggable="false"
                />
              ) : (
                <p className="viewfinder__shot-missing" role="status">
                  Photo preview is unavailable. Retake this photo to try again.
                </p>
              )}
            </div>

            <div className="shot-review-dock">
              <div className="shot-review-dock__copy">
                <h1
                  id="capture-title"
                  className="shot-review-dock__title"
                  data-screen-heading
                  tabIndex={-1}
                >
                  Like this shot?
                </h1>
                <p className="shot-review-dock__subtitle">
                  Photo {safeShot} of {safeTotal}.{' '}
                  {safeShot < safeTotal
                    ? 'Keep it for the next shot or retake.'
                    : 'Keep it to review all photos or retake.'}
                </p>
                {props.errorMessage ? (
                  <p className="shot-review-dock__error" role="alert">
                    {props.errorMessage}
                  </p>
                ) : null}
              </div>

              <ol
                className={`shot-review-strip${safeTotal > 6 ? ' is-compact' : ''}`}
                aria-label="Session photo slots"
                data-testid="shot-review-strip"
              >
                {Array.from({ length: safeTotal }, (_, index) => {
                  const slot = index + 1;
                  const slotUrl = props.captureUrls[index];
                  const isCurrent = slot === safeShot;
                  const isDone = slot < safeShot && Boolean(slotUrl);
                  const slotStatus = isCurrent ? 'current photo' : isDone ? 'captured' : 'upcoming';

                  return (
                    <li
                      key={slot}
                      className={`shot-review-slot${
                        isCurrent ? ' is-current' : isDone ? ' is-done' : ' is-upcoming'
                      }`}
                      aria-current={isCurrent ? 'step' : undefined}
                      aria-label={`Photo ${slot} of ${safeTotal}: ${slotStatus}`}
                      data-slot={slot}
                    >
                      {slotUrl ? (
                        <img src={slotUrl} alt="" aria-hidden="true" draggable="false" />
                      ) : null}
                      <span className="shot-review-slot__badge" aria-hidden="true">
                        {slot}
                      </span>
                    </li>
                  );
                })}
              </ol>

              <div className="shot-review-dock__actions">
                <Button
                  className="button--review-retake button--shot-review"
                  data-testid="shot-review-retake"
                  disabled={Boolean(props.busy) || !props.canRetakeShot}
                  onClick={props.onRetakeShot}
                  variant="secondary"
                >
                  Retake photo
                </Button>
                <Button
                  className="button--review-accept button--shot-review"
                  data-testid="shot-review-continue"
                  disabled={Boolean(props.busy) || !props.canAcceptShot}
                  onClick={props.onAcceptShot}
                >
                  {safeShot < safeTotal ? 'Next photo' : 'Review all photos'}
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="viewfinder__scrim" aria-hidden="true" />
            {phase === 'countdown' ? (
              <div className="countdown-stack">
                <p className="countdown-stack__prompt" aria-hidden="true">
                  {props.secondsRemaining <= 3
                    ? 'Hold your pose…'
                    : 'Get ready! Snapping your photo in…'}
                </p>
                <p className="countdown-stack__pose">{poseSuggestion}</p>
                <div className="countdown-card">
                  <span
                    className="countdown-card__number"
                    data-testid="countdown-value"
                    role="timer"
                    aria-label={`${props.secondsRemaining} seconds until photo ${safeShot}`}
                  >
                    {props.secondsRemaining}
                  </span>
                </div>
                <h1 className="sr-only" id="capture-title" data-screen-heading tabIndex={-1}>
                  {props.secondsRemaining <= 3 ? 'Hold your pose' : 'Get ready'}
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
                <p className="countdown-card__capturing-pill" aria-hidden="true">
                  Taking photo…
                </p>
              </div>
            )}
          </>
        )}
        <div
          className={`shutter-flash${phase === 'capturing' ? ' is-active' : ''}`}
          aria-hidden="true"
        />
      </section>
    </main>
  );
}
