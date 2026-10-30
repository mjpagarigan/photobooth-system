import { WarningCircle } from '@grace-booth/ui';
import { useCallback, useEffect, useMemo, useState } from 'react';

import type { GalleryItem, GraceBoothBridge, QrStationState } from '@grace-booth/shared';

import { Button } from '../components/Button';
import { Photostrip } from '../components/Photostrip';
import { RecentGallery } from '../components/RecentGallery';
import { LOCAL_FIXTURES } from '../local-fixtures';

function getBridge(): GraceBoothBridge | null {
  return window.graceBooth ?? null;
}

const DEFAULT_QR_STATE: QrStationState = {
  status: 'idle',
  sessionId: null,
  collageUrl: null,
  qrImageUrl: null,
  expiresAt: null,
  durationSeconds: 45,
  message: null,
  canRetryUpload: false,
};

export function QrStationScreen(): React.ReactElement {
  const [stationState, setStationState] = useState<QrStationState>(DEFAULT_QR_STATE);
  const [secondsRemaining, setSecondsRemaining] = useState<number>(45);
  const [recentOpen, setRecentOpen] = useState(false);
  const [recentItems, setRecentItems] = useState<GalleryItem[]>([]);
  const [recentBusy, setRecentBusy] = useState(false);
  const [recentError, setRecentError] = useState<string | null>(null);

  // Subscribe to QR station state
  useEffect(() => {
    if (
      import.meta.env.DEV &&
      new URLSearchParams(window.location.search).get('visual') === 'qr-station-active'
    ) {
      void import('../visual-fixtures').then(async ({ createQrStationVisualState }) => {
        setStationState(await createQrStationVisualState());
      });
      return;
    }

    const bridge = getBridge();
    if (!bridge) return;

    void bridge.qrStation.getState().then((result) => {
      if (result.ok) setStationState(result.data);
    });

    const unsubscribe = bridge.qrStation.subscribe((state) => {
      setStationState(state);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  // Countdown timer for active QR display
  useEffect(() => {
    if (stationState.status === 'idle' || !stationState.expiresAt) {
      return;
    }

    const updateTimer = () => {
      const remainingMs = (stationState.expiresAt ?? 0) - Date.now();
      const remainingSec = Math.max(0, Math.ceil(remainingMs / 1000));
      setSecondsRemaining(remainingSec);
    };

    updateTimer();
    const interval = window.setInterval(updateTimer, 500);
    return () => {
      window.clearInterval(interval);
    };
  }, [stationState.status, stationState.expiresAt]);

  const handleDismiss = useCallback(async () => {
    const bridge = getBridge();
    if (!bridge) return;
    const result = await bridge.qrStation.dismiss(stationState.sessionId);
    if (result.ok) {
      setStationState(result.data);
    }
  }, [stationState.sessionId]);

  const openRecentGallery = useCallback(async () => {
    const bridge = getBridge();
    if (!bridge) return;
    setRecentOpen(true);
    setRecentBusy(true);
    setRecentError(null);
    try {
      const result = await bridge.gallery.getRecent(20);
      if (result.ok) {
        setRecentItems(result.data);
      } else {
        setRecentError(result.error.message || 'Recent photos could not be loaded.');
      }
    } catch {
      setRecentError('Recent photos could not be loaded.');
    } finally {
      setRecentBusy(false);
    }
  }, []);

  const closeRecentGallery = useCallback(() => {
    setRecentOpen(false);
  }, []);

  const progressPercentage = useMemo(() => {
    if (stationState.status === 'idle' || !stationState.durationSeconds) return 0;
    return Math.max(0, Math.min(100, (secondsRemaining / stationState.durationSeconds) * 100));
  }, [stationState.status, stationState.durationSeconds, secondsRemaining]);

  const recentButton = (
    <button
      className="operator-access recent-access qr-station__recent"
      onClick={() => void openRecentGallery()}
      aria-label="Recent Photos"
      title="Recent Photos"
      type="button"
    >
      <span className="operator-access__text">Recent</span>
    </button>
  );

  const recentGallery = recentOpen ? (
    <RecentGallery
      items={recentItems}
      busy={recentBusy}
      error={recentError}
      onClose={closeRecentGallery}
    />
  ) : null;

  const timer = (
    <div className="qr-station__timer">
      <span>Clears in {secondsRemaining}s</span>
      <div className="qr-station__timer-bar" aria-hidden="true">
        <div className="qr-station__timer-progress" style={{ width: `${progressPercentage}%` }} />
      </div>
    </div>
  );

  if (stationState.status === 'error') {
    return (
      <main className="screen screen--qr-station qr-station--error" data-testid="qr-station-error">
        {timer}
        <section className="qr-station__message" aria-labelledby="qr-station-error-title">
          <WarningCircle aria-hidden="true" size={56} />
          <h1 id="qr-station-error-title" data-screen-heading tabIndex={-1}>
            Photo delivery unavailable
          </h1>
          <p>{stationState.message ?? 'Ask an operator for help or try another photo session.'}</p>
          <Button className="button--station-done" onClick={() => void handleDismiss()}>
            Done
          </Button>
        </section>
      </main>
    );
  }

  if (stationState.status === 'idle' || !stationState.collageUrl || !stationState.qrImageUrl) {
    return (
      <main className="screen screen--qr-station qr-station--idle" data-testid="qr-station-idle">
        {recentButton}
        <section className="qr-station__message" aria-labelledby="qr-station-idle-title">
          <img
            className="qr-station__logo"
            src={LOCAL_FIXTURES.ministryIdleBackground}
            alt="M.A.T. Media and Technology"
            draggable="false"
          />
          <h1 id="qr-station-idle-title">Your photo appears here.</h1>
          <p>Finish on the main screen, then scan your code right here.</p>
        </section>
        {recentGallery}
      </main>
    );
  }

  return (
    <main className="screen screen--qr-station qr-station--active" data-testid="qr-station-active">
      <div className="qr-station__corner">
        {timer}
        {recentButton}
      </div>
      <div className="qr-station__layout">
        <section className="final-result qr-station__result" aria-label="Your finished photo">
          <Photostrip
            collageUrl={stationState.collageUrl}
            label="Your finished photo"
            variant="collage"
          />
        </section>
        <section className="qr-station__panel" aria-labelledby="qr-station-title">
          <h1 id="qr-station-title" data-screen-heading tabIndex={-1}>
            You’re all set. <span>Scan to take it home.</span>
          </h1>
          <p>Available for 30 days</p>
          <div className="qr-station__code">
            <img src={stationState.qrImageUrl} alt="QR code for photo download" draggable="false" />
          </div>
          <Button className="button--station-done" onClick={() => void handleDismiss()}>
            Done
          </Button>
        </section>
      </div>
      {recentGallery}
    </main>
  );
}
