import {
  CalendarBlankIcon as CalendarBlank,
  CheckCircleIcon as CheckCircle,
  ImagesIcon as Images,
} from '@phosphor-icons/react';
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

  // Countdown timer for active QR
  useEffect(() => {
    if (stationState.status !== 'active' || !stationState.expiresAt) {
      return;
    }

    const updateTimer = () => {
      const remainingMs = (stationState.expiresAt ?? 0) - Date.now();
      const remainingSec = Math.max(0, Math.ceil(remainingMs / 1000));
      setSecondsRemaining(remainingSec);

      if (remainingSec <= 0) {
        const bridge = getBridge();
        void bridge?.qrStation.dismiss();
      }
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
    const result = await bridge.qrStation.dismiss();
    if (result.ok) {
      setStationState(result.data);
    }
  }, []);

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
    if (stationState.status !== 'active' || !stationState.durationSeconds) return 0;
    return Math.max(0, Math.min(100, (secondsRemaining / stationState.durationSeconds) * 100));
  }, [stationState.status, stationState.durationSeconds, secondsRemaining]);

  const idleBackground =
    ('ministryIdleBackground' in LOCAL_FIXTURES
      ? (LOCAL_FIXTURES as unknown as Record<string, string>).ministryIdleBackground
      : null) ?? LOCAL_FIXTURES.finalBackground;

  // 1. Idle State: Full bleed background with top-right Recent Photos button
  if (stationState.status === 'idle' || !stationState.collageUrl || !stationState.qrImageUrl) {
    return (
      <main
        className="screen screen--final screen--qr-station qr-station--idle"
        data-testid="qr-station-idle"
      >
        <img
          className="final-background qr-station__background"
          src={idleBackground}
          alt=""
          aria-hidden="true"
          draggable="false"
        />
        <div className="final-top-controls qr-station__top-controls">
          <button
            className="operator-access recent-access"
            onClick={() => void openRecentGallery()}
            aria-label="Recent Photos"
            title="Recent Photos"
          >
            <Images aria-hidden="true" weight="bold" />
            <span className="operator-access__text">Recent</span>
          </button>
        </div>

        {recentOpen && (
          <RecentGallery
            items={recentItems}
            busy={recentBusy}
            error={recentError}
            onClose={closeRecentGallery}
          />
        )}
      </main>
    );
  }

  // 2. Active QR State: Collage preview + QR code + timer + actions
  return (
    <main
      className="screen screen--final screen--qr-station qr-station--active"
      data-testid="qr-station-active"
    >
      <img
        className="final-background qr-station__background"
        src={LOCAL_FIXTURES.finalBackground}
        alt=""
        aria-hidden="true"
        draggable="false"
      />
      <div className="final-scrim" aria-hidden="true" />
      <div className="final-top-controls qr-station__top-controls">
        <button
          className="operator-access recent-access"
          onClick={() => void openRecentGallery()}
          aria-label="Recent Photos"
          title="Recent Photos"
        >
          <Images aria-hidden="true" weight="bold" />
          <span className="operator-access__text">Recent</span>
        </button>
      </div>

      <div className="final-composition">
        <section className="final-result" aria-label="Your finished photo">
          <Photostrip
            collageUrl={stationState.collageUrl}
            label="Your finished three-photo strip"
            variant="collage"
          />
        </section>

        <section className="qr-panel" aria-labelledby="qr-station-title">
          <div className="qr-panel__copy">
            <h1 id="qr-station-title" data-screen-heading tabIndex={-1}>
              Scan to Download
            </h1>
            <p>Scan the QR code with your phone camera to download your photo strip.</p>
          </div>

          <div className="qr-panel__code">
            <img
              src={stationState.qrImageUrl}
              alt="QR code for photo download"
              draggable="false"
            />
          </div>

          <div className="qr-station__timer-bar" aria-hidden="true">
            <div
              className="qr-station__timer-progress"
              style={{ width: `${progressPercentage}%` }}
            />
          </div>

          <div className="qr-panel__notice">
            <CalendarBlank aria-hidden="true" weight="bold" />
            <span>Auto-clearing in {secondsRemaining}s • Available for 30 days</span>
          </div>

          <div className="qr-panel__actions">
            <Button
              className="qr-panel__done"
              iconAfter={<CheckCircle aria-hidden="true" weight="bold" />}
              onClick={() => void handleDismiss()}
              wide
            >
              Done
            </Button>
          </div>
        </section>
      </div>

      {recentOpen && (
        <RecentGallery
          items={recentItems}
          busy={recentBusy}
          error={recentError}
          onClose={closeRecentGallery}
        />
      )}
    </main>
  );
}
