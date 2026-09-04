import { Check, CloudArrowUp, FilmStrip, LockKey, QrCode } from '@grace-booth/ui';
import { LottieLight } from 'lottie-react';
import { useEffect, useState } from 'react';

import type { SessionState } from '@grace-booth/shared';

import { LOCAL_FIXTURES } from '../local-fixtures';

type ProcessingScreenProps = {
  message?: string | null;
  state: SessionState | null;
  onOpenAdmin?: () => void;
};

type ProcessingCopy = {
  headline: string;
  status: string;
  activeStep: number;
};

function copyForState(
  state: SessionState | null,
  message: string | null | undefined,
): ProcessingCopy {
  if (state === 'uploading') {
    return {
      headline: 'Uploading your photo',
      status: message ?? 'Sending your collage to secure cloud storage.',
      activeStep: 2,
    };
  }

  if (state === 'pending_upload') {
    return {
      headline: 'Your photo is safely saved',
      status:
        message ??
        'Your collage is saved on this booth. Waiting to upload when the connection is ready.',
      activeStep: 2,
    };
  }

  if (state === 'ready') {
    return {
      headline: 'Preparing your QR code',
      status: 'Creating a private download link for your phone.',
      activeStep: 3,
    };
  }

  return {
    headline: 'Creating your collage',
    status: message ?? 'Combining your three photos into one finished image.',
    activeStep: 1,
  };
}

const STEPS = [
  { label: 'Build collage', icon: FilmStrip },
  { label: 'Upload', icon: CloudArrowUp },
  { label: 'Create QR code', icon: QrCode },
] as const;

export function ProcessingScreen({ message, onOpenAdmin, state }: ProcessingScreenProps) {
  const copy = copyForState(state, message);
  const [reducedMotion, setReducedMotion] = useState(
    () =>
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  return (
    <main
      aria-busy="true"
      className="screen screen--processing"
      data-state={state ?? 'unknown'}
      data-testid="processing-screen"
    >
      <img
        className="processing-background"
        src={LOCAL_FIXTURES.processingBackground}
        alt=""
        aria-hidden="true"
        draggable="false"
      />
      <div className="processing-scrim" aria-hidden="true" />
      {onOpenAdmin ? (
        <button className="operator-access" onClick={onOpenAdmin} aria-label="Admin" title="Admin">
          <LockKey aria-hidden="true" weight="bold" />
          <span>Admin</span>
        </button>
      ) : null}
      <section
        className="processing-card"
        aria-labelledby="processing-title"
        role="status"
        aria-live="polite"
      >
        <div className="processing-animation" data-testid="processing-animation" aria-hidden="true">
          {reducedMotion ? (
            <div className="processing-animation__fallback" />
          ) : (
            <LottieLight
              src={LOCAL_FIXTURES.processingAnimation}
              autoplay
              loop
              rendererSettings={{ preserveAspectRatio: 'xMidYMid meet' }}
            />
          )}
        </div>
        <h1 id="processing-title" data-screen-heading tabIndex={-1}>
          {copy.headline}
        </h1>
        <p>{copy.status}</p>
        <ol className="processing-steps" aria-label="Photo preparation progress">
          {STEPS.map(({ icon: Icon, label }, index) => {
            const stepNumber = index + 1;
            const complete = stepNumber < copy.activeStep;
            const active = stepNumber === copy.activeStep;
            return (
              <li
                className={`${complete ? 'is-complete' : ''}${active ? ' is-active' : ''}`}
                key={label}
                aria-current={active ? 'step' : undefined}
              >
                <span className="processing-steps__icon">
                  {complete ? (
                    <Check aria-hidden="true" weight="bold" />
                  ) : (
                    <Icon aria-hidden="true" weight="bold" />
                  )}
                </span>
                <span>{label}</span>
              </li>
            );
          })}
        </ol>
      </section>
    </main>
  );
}
