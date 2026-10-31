import {
  ArrowClockwise,
  Button,
  DownloadSimple,
  HandHeart,
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

function PageFrame({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="page-frame">
      <header className="site-header">
        <span className="site-header__brand">M.A.T. Photobooth</span>
        <span className="site-header__note">Private photo</span>
      </header>
      {children}
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
      <h1>
        Your photo is almost ready
        <span>Opening the photo connected to this QR code.</span>
      </h1>
      <div className="photo-card photo-card--loading" aria-hidden="true">
        <Skeleton className="skeleton-photo" />
      </div>
      <span className="sr-only">Loading photo</span>
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
    <main className="photo-layout error-layout" data-state="error">
      <section className="error-card" aria-labelledby="error-title">
        <div className="error-symbol" aria-hidden="true">
          <WarningOctagon size={30} />
        </div>
        <h1 id="error-title">We could not open this photo.</h1>
        <p className="error-message">{message}</p>
        <p className="muted-copy">
          Check that the whole QR link opened. Links expire automatically after 30 days.
        </p>
        {retryable ? (
          <Button
            className="secondary-pill"
            icon={<ArrowClockwise size={16} aria-hidden="true" weight="bold" />}
            onClick={onRetry}
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
      <h1 id="photo-title">
        You’re all set. <span>Here’s your keepsake.</span>
      </h1>
      <section className="photo-card" aria-label="Your finished photo">
        <img src={imageUrl} alt="M.A.T. Photobooth finished event collage" />
      </section>
      <div className="action-stack">
        <Button
          className="primary-pill"
          disabled={downloadState === 'working'}
          icon={<DownloadSimple size={20} aria-hidden="true" weight="bold" />}
          loading={downloadState === 'working'}
          onClick={() => void downloadPhoto()}
          type="button"
          variant="primary"
        >
          <span>{downloadState === 'working' ? 'Preparing download…' : 'Download photo'}</span>
        </Button>
        <p className="mobile-save-hint">
          On iPhone or iPad, touch and hold the photo to save it to Photos.
        </p>
        {downloadState === 'error' ? (
          <p className="inline-error" role="alert">
            The download did not start. Please try again.
          </p>
        ) : null}
      </div>
      <p className="availability-note">
        Available until {availableUntil}. This private link and its cloud copy expire automatically.
      </p>
      <section className="recruit-card" aria-labelledby="recruit-title">
        <HandHeart size={26} aria-hidden="true" />
        <h2 id="recruit-title">Get involved</h2>
        <p>Find a ministry where you can serve with M.A.T.</p>
        <a
          href={
            details.googleFormsUrl ?? 'https://volunteer-management.ccf.org.ph/recruitment/form'
          }
          target="_blank"
          rel="noopener noreferrer external"
        >
          {details.recruitmentButtonText}
          <span aria-hidden="true">↗</span>
        </a>
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
