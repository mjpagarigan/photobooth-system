import { CloudSlash, SpinnerGap, VideoCameraSlash } from '@grace-booth/ui';
import { useEffect, useRef } from 'react';

import { Button } from '../components/Button';
import type { RecoveryVariant } from '../types';

type RecoveryScreenProps = {
  busy?: boolean;
  canRetryUpload?: boolean;
  canFinishOffline?: boolean;
  message?: string | null;
  onOpenAdmin: () => void;
  onRestart: () => void;
  onRetryUpload: () => void;
  onFinishOffline?: () => void;
  variant: RecoveryVariant;
};

const COPY = {
  camera: {
    title: 'Your camera needs a hand.',
    body: 'Ask a booth volunteer to check the camera connection, then start again.',
    action: 'Restart session',
    icon: VideoCameraSlash,
  },
  upload: {
    title: 'Your upload didn’t finish.',
    body: 'Your photo is safe on this booth. Try again, or finish offline and download it over the booth’s network.',
    action: 'Retry upload',
    icon: CloudSlash,
  },
  interrupted: {
    title: 'Picking up where you left off.',
    body: 'The booth is checking your saved photos.',
    action: null,
    icon: SpinnerGap,
  },
} as const;

export function RecoveryScreen({
  busy = false,
  canRetryUpload = false,
  canFinishOffline = false,
  message,
  onOpenAdmin,
  onRestart,
  onRetryUpload,
  onFinishOffline,
  variant,
}: RecoveryScreenProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const copy = COPY[variant];
  const Icon = copy.icon;

  useEffect(() => {
    headingRef.current?.focus();
  }, [variant]);

  return (
    <main className="screen screen--recovery" data-testid={`recovery-${variant}`}>
      <article
        className="recovery-card"
        role={variant === 'interrupted' ? 'status' : 'alert'}
        aria-live={variant === 'interrupted' ? 'polite' : 'assertive'}
      >
        <div className={`recovery-card__icon recovery-card__icon--${variant}`} aria-hidden="true">
          <Icon />
        </div>
        <h1 ref={headingRef} tabIndex={-1} data-screen-heading>
          {copy.title}
        </h1>
        <p>{message ?? copy.body}</p>
        {variant === 'camera' ? (
          <div className="recovery-actions recovery-actions--single">
            <Button className="button--recovery-primary" loading={busy} onClick={onRestart}>
              {copy.action}
            </Button>
          </div>
        ) : null}
        {variant === 'upload' ? (
          <div className="recovery-actions">
            {onFinishOffline && (
              <Button
                className="button--recovery-dark"
                disabled={!canFinishOffline}
                loading={busy}
                onClick={onFinishOffline}
              >
                Finish offline
              </Button>
            )}
            <Button
              className="button--recovery-primary"
              disabled={!canRetryUpload}
              loading={busy}
              onClick={onRetryUpload}
            >
              {copy.action}
            </Button>
          </div>
        ) : null}
        {variant !== 'interrupted' ? (
          <p className="recovery-card__help">Still stuck? Ask a booth volunteer.</p>
        ) : null}
      </article>
      {variant !== 'interrupted' ? (
        <button
          className="operator-access recovery-admin"
          onClick={onOpenAdmin}
          aria-label="Admin"
          title="Admin"
          type="button"
        >
          <span>Admin</span>
        </button>
      ) : null}
    </main>
  );
}
