import {
  Aperture,
  ArrowClockwise,
  Badge,
  Button,
  CalendarBlank,
  DownloadSimple,
  HandHeart,
  Info,
  ShieldCheck,
  Skeleton,
  WarningOctagon,
} from '@grace-booth/ui';
import { useEffect, useMemo, useState } from 'react';
import {
  fetchPhotoDownload,
  fetchPhotoImage,
  PhotoApiError,
  resolvePhoto,
  type ResolvedPhoto,
} from './api';
import { isExpectedPageOrigin } from './config';
import { tokenFromFragment } from './token';

type ViewState =
  | { kind: 'loading' }
  | { kind: 'ready'; details: ResolvedPhoto; imageUrl: string }
  | { kind: 'error'; message: string; retryable: boolean };

function Brand(): React.JSX.Element {
  return (
    <div className="brand" aria-label="M.A.T. Photobooth">
      <span className="brand-mark" aria-hidden="true">
        <Aperture size={24} weight="bold" />
      </span>
      <div className="brand-text">
        <strong>M.A.T.</strong>
        <span className="brand-sub">Photobooth</span>
      </div>
    </div>
  );
}

function PageFrame({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="page-frame isolate relative min-h-screen">
      <header className="site-header">
        <Brand />
        <Badge variant="info" className="header-badge">
          Private photo
        </Badge>
      </header>
      {children}
      <footer className="site-footer">
        <p>M.A.T. Photobooth</p>
        <p className="footer-meta">Private link · Available for 30 days</p>
      </footer>
    </div>
  );
}

function LoadingView(): React.JSX.Element {
  return (
    <main
      aria-label="Loading photo"
      aria-live="polite"
      aria-busy="true"
      className="photo-layout"
      data-state="loading"
      tabIndex={0}
    >
      <section className="detail-panel loading-panel">
        <div className="eyebrow-wrapper">
          <Badge variant="info" size="sm" className="eyebrow">
            Loading your photo
          </Badge>
        </div>
        <h1>Your photo is almost ready</h1>
        <p className="lead-copy">
          We’re securely opening the photo connected to this QR code.
        </p>
        <div className="skeleton-lines">
          <Skeleton className="h-4 w-full max-w-sm my-1.5" />
          <Skeleton className="h-4 w-3/4 max-w-xs my-1.5" />
        </div>
        <span className="sr-only">Loading photo</span>
      </section>
      <section className="photo-stage skeleton-stage" aria-label="Loading your photo">
        <div className="stage-label" aria-hidden="true">
          <span>Loading keepsake</span>
        </div>
        <div className="photo-mat">
          <div className="skeleton-photo" />
        </div>
      </section>
    </main>
  );
}

function ErrorView({
  message,
  retryable,
  onRetry,
}: {
  message: string;
  retryable: boolean;
  onRetry: () => void;
}): React.JSX.Element {
  return (
    <main className="error-layout" data-state="error">
      <section className="error-card" aria-labelledby="error-title">
        <div className="error-symbol" aria-hidden="true">
          <WarningOctagon size={32} weight="bold" />
        </div>
        <Badge variant="error" size="sm" className="error-badge">
          Photo unavailable
        </Badge>
        <h1 id="error-title">We could not open this photo.</h1>
        <p className="error-message">{message}</p>
        <p className="muted-copy">
          Verify the complete QR URL was opened. Tokens expire automatically after 30 days.
        </p>
        {retryable ? (
          <Button
            className="compact-button mt-4"
            icon={<ArrowClockwise size={16} aria-hidden="true" weight="bold" />}
            onClick={onRetry}
            size="default"
            type="button"
            variant="secondary"
          >
            <span>Try again</span>
          </Button>
        ) : null}
      </section>
    </main>
  );
}

function ReadyView({
  token,
  details,
  imageUrl,
}: {
  token: string;
  details: ResolvedPhoto;
  imageUrl: string;
}): React.JSX.Element {
  const [downloadState, setDownloadState] = useState<'idle' | 'working' | 'error'>('idle');
  const availableUntil = useMemo(() => {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'long',
      timeZone: 'UTC',
    }).format(new Date(details.expiresAt));
  }, [details.expiresAt]);

  async function downloadPhoto(): Promise<void> {
    setDownloadState('working');
    try {
      const blob = await fetchPhotoDownload(token);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'mat-photobooth-keepsake.jpg';
      link.rel = 'noopener';
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setDownloadState('idle');
    } catch {
      setDownloadState('error');
    }
  }

  return (
    <main className="photo-layout" data-state="ready">
      <section className="detail-panel" aria-labelledby="photo-title">
        <div>
          <div className="eyebrow-wrapper">
            <Badge variant="success" className="eyebrow success-eyebrow">
              <ShieldCheck size={14} weight="bold" aria-hidden="true" />
              <span>Photo ready</span>
            </Badge>
          </div>
          <h1 id="photo-title">Hold on to this moment.</h1>
          <p className="lead-copy">
            Your finished 3-frame photobooth strip is prepared for download. Save it directly to
            your device storage before expiration.
          </p>
        </div>

        <div className="action-stack">
          <Button
            className="primary-button w-full"
            disabled={downloadState === 'working'}
            icon={<DownloadSimple size={20} aria-hidden="true" weight="bold" />}
            loading={downloadState === 'working'}
            onClick={() => void downloadPhoto()}
            size="lg"
            type="button"
            variant="primary"
          >
            <span>{downloadState === 'working' ? 'Preparing download…' : 'Download photo'}</span>
          </Button>
          <a
            className="secondary-button"
            href={
              details.googleFormsUrl ?? 'https://volunteer-management.ccf.org.ph/recruitment/form'
            }
            target="_blank"
            rel="noopener noreferrer external"
          >
            <HandHeart size={20} weight="bold" aria-hidden="true" />
            <span>Join a ministry</span>
          </a>
          <p className="mobile-save-hint">
            <Info aria-hidden="true" size={16} />
            <span>On iPhone or iPad, touch and hold the photo to save it to Photos.</span>
          </p>
          {downloadState === 'error' ? (
            <p className="inline-error" role="alert">
              The download did not start. Please try again.
            </p>
          ) : null}
        </div>

        <div className="availability-note">
          <CalendarBlank className="availability-note__icon" aria-hidden="true" size={20} />
          <p>
            <strong>Available until {availableUntil}</strong>
            <span>This private link and cloud copy expire automatically.</span>
          </p>
        </div>
      </section>

      <section className="photo-stage" aria-label="Your finished photo">
        <div className="stage-label" aria-hidden="true">
          <span>Your finished photo</span>
        </div>
        <div className="photo-mat">
          <img src={imageUrl} alt="M.A.T. Photobooth finished event collage" />
        </div>
        <p className="stage-caption">High-resolution photobooth keepsake</p>
      </section>
    </main>
  );
}

export function App(): React.JSX.Element {
  const token = useMemo(() => tokenFromFragment(window.location.hash), []);
  const canLoad = token !== null && isExpectedPageOrigin();
  const [attempt, setAttempt] = useState(0);
  const [view, setView] = useState<ViewState>(() =>
    canLoad
      ? { kind: 'loading' }
      : {
          kind: 'error',
          message: 'This photo is unavailable or has expired.',
          retryable: false,
        },
  );

  useEffect(() => {
    if (!token || !canLoad) return;

    const abortController = new AbortController();
    let objectUrl: string | null = null;
    void (async () => {
      try {
        const details = await resolvePhoto(token, abortController.signal);
        const image = await fetchPhotoImage(token, abortController.signal);
        if (abortController.signal.aborted) return;
        objectUrl = URL.createObjectURL(image);
        setView({ kind: 'ready', details, imageUrl: objectUrl });
      } catch (error) {
        if (abortController.signal.aborted) return;
        setView({
          kind: 'error',
          message:
            error instanceof PhotoApiError
              ? error.message
              : 'We could not load this photo right now.',
          retryable: error instanceof PhotoApiError ? error.retryable : true,
        });
      }
    })();

    return () => {
      abortController.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [attempt, canLoad, token]);

  function retry(): void {
    setView({ kind: 'loading' });
    setAttempt((value) => value + 1);
  }

  return (
    <PageFrame>
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {view.kind === 'loading'
          ? 'Loading your photo.'
          : view.kind === 'ready'
            ? 'Your photo is ready.'
            : 'The photo could not be opened.'}
      </div>
      {view.kind === 'loading' ? <LoadingView /> : null}
      {view.kind === 'error' ? (
        <ErrorView message={view.message} retryable={view.retryable} onRetry={retry} />
      ) : null}
      {view.kind === 'ready' ? (
        <ReadyView token={token ?? ''} details={view.details} imageUrl={view.imageUrl} />
      ) : null}
    </PageFrame>
  );
}
