import { useEffect, useState } from 'react';

import type { SessionState } from '@grace-booth/shared';

type ProcessingScreenProps = {
  message?: string | null;
  state: SessionState | null;
  onOpenAdmin?: () => void;
};

type ProcessingCopy = {
  headline: string;
  subline: string;
  detail: string | null;
  activeStep: number;
};

function copyForState(
  state: SessionState | null,
  message: string | null | undefined,
): ProcessingCopy {
  const detail = message ?? null;
  if (state === 'uploading') {
    return {
      headline: 'Sending it to your phone.',
      subline: 'Uploading securely.',
      detail,
      activeStep: 3,
    };
  }

  if (state === 'pending_upload') {
    return {
      headline: 'Your photo is safely saved.',
      subline: 'Waiting for the connection.',
      detail,
      activeStep: 3,
    };
  }

  if (state === 'ready') {
    return {
      headline: 'Almost there.',
      subline: 'Making your private link.',
      detail: null,
      activeStep: 4,
    };
  }

  return {
    headline: 'Creating your keepsake.',
    subline: 'It only takes a few seconds.',
    detail,
    activeStep: 1,
  };
}

const STEPS = [
  'Composing your collage',
  'Saving it safely on this booth',
  'Uploading for your phone',
  'Making your QR code',
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
      {onOpenAdmin ? (
        <button
          className="operator-access processing-admin"
          onClick={onOpenAdmin}
          aria-label="Admin"
          title="Admin"
          type="button"
        >
          <span>Admin</span>
        </button>
      ) : null}
      <section
        className="processing-copy"
        aria-labelledby="processing-title"
        role="status"
        aria-live="polite"
      >
        <svg className="processing-copy__mark" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />
        </svg>
        <h1 id="processing-title" data-screen-heading tabIndex={-1}>
          {copy.headline}
          <br />
          <span>{copy.subline}</span>
        </h1>
        {copy.detail ? <p className="processing-copy__detail">{copy.detail}</p> : null}
        <ol className="processing-steps" aria-label="Photo preparation progress">
          {STEPS.map((label, index) => {
            const stepNumber = index + 1;
            const complete = stepNumber < copy.activeStep;
            const active = stepNumber === copy.activeStep;
            return (
              <li
                className={complete ? 'is-complete' : active ? 'is-active' : undefined}
                key={label}
                aria-current={active ? 'step' : undefined}
              >
                <span className="processing-steps__icon" aria-hidden="true">
                  {complete ? (
                    <svg viewBox="0 0 24 24">
                      <circle cx="12" cy="12" r="10" />
                      <path d="M7.5 12.2l3 3 6-6.2" />
                    </svg>
                  ) : null}
                </span>
                <span>{label}</span>
              </li>
            );
          })}
        </ol>
      </section>
      <div className="processing-stage" aria-hidden="true">
        <div className="processing-animation" data-testid="processing-animation">
          {reducedMotion ? (
            <div className="processing-animation__fallback" />
          ) : (
            <svg className="processing-strip" viewBox="0 0 120 270">
              <rect
                className="processing-strip__frame"
                x="0"
                y="0"
                width="120"
                height="270"
                rx="6"
              />
              <rect className="processing-strip__band" x="8" y="8" width="104" height="24" rx="3" />
              {[0, 1, 2].map((index) => (
                <rect
                  className="processing-strip__shot"
                  key={index}
                  x="8"
                  y={40 + index * 70}
                  width="104"
                  height="62"
                  rx="2"
                />
              ))}
            </svg>
          )}
        </div>
      </div>
    </main>
  );
}
