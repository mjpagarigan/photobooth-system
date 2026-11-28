import { Button, SpinnerGap, WarningCircle, WifiHigh } from '@grace-booth/ui';
import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  isSessionPrintActive,
  qrStationAllowsAutoDismiss,
  type GalleryItem,
  type GraceBoothBridge,
  type QrStationState,
} from '@grace-booth/shared';

import { Photostrip } from '../components/Photostrip';
import { PrinterIndicator } from '../components/Printing';
import { SessionPrintStatus } from '../components/SessionPrintStatus';
import { usePrinterHealth } from '../hooks/usePrinterHealth';
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
  canFinishOffline: false,
  printStatus: null,
};

export function QrStationScreen(): React.ReactElement {
  const [stationState, setStationState] = useState<QrStationState>(DEFAULT_QR_STATE);
  const printerHealth = usePrinterHealth();
  const [secondsRemaining, setSecondsRemaining] = useState<number>(45);
  const [dismissing, setDismissing] = useState(false);
  const [recoveryAction, setRecoveryAction] = useState<'retry' | 'offline' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [recentOpen, setRecentOpen] = useState(false);
  const [recentItems, setRecentItems] = useState<GalleryItem[]>([]);
  const [recentBusy, setRecentBusy] = useState(false);
  const [recentError, setRecentError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;

    const connectLiveBridge = () => {
      const bridge = getBridge();
      if (!bridge || !active) return;

      void bridge.qrStation.getState().then((result) => {
        if (active && result.ok) setStationState(result.data);
      });

      unsubscribe = bridge.qrStation.subscribe((state) => {
        if (!active) return;
        setStationState(state);
        setActionError(null);
      });
    };

    if (import.meta.env.DEV && new URLSearchParams(window.location.search).has('visual')) {
      void import('../visual-fixtures').then(async ({ readQrStationVisualFixture }) => {
        const fixture = await readQrStationVisualFixture(window.location.search);
        if (!active) return;
        if (fixture) {
          setStationState(fixture);
        } else {
          connectLiveBridge();
        }
      });
    } else {
      connectLiveBridge();
    }

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  const allowsAutoDismiss = qrStationAllowsAutoDismiss(stationState);

  useEffect(() => {
    if (!allowsAutoDismiss || !stationState.expiresAt) {
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
  }, [allowsAutoDismiss, stationState.expiresAt]);

  const actionBusy = dismissing || recoveryAction !== null;

  const handleDismiss = useCallback(async () => {
    const bridge = getBridge();
    if (!bridge || actionBusy) return;
    setDismissing(true);
    setActionError(null);
    try {
      const result = await bridge.qrStation.dismiss(stationState.sessionId);
      if (result.ok) {
        setStationState(result.data);
      }
    } finally {
      setDismissing(false);
    }
  }, [actionBusy, stationState.sessionId]);

  const handleRetryUpload = useCallback(async () => {
    const bridge = getBridge();
    if (!bridge || actionBusy || !stationState.sessionId) return;
    setRecoveryAction('retry');
    setActionError(null);
    try {
      const result = await bridge.qrStation.retryUpload(stationState.sessionId);
      if (result.ok) {
        setStationState(result.data);
      } else {
        setActionError(result.error.message || 'Could not retry upload right now.');
      }
    } catch {
      setActionError('Could not retry upload right now.');
    } finally {
      setRecoveryAction(null);
    }
  }, [actionBusy, stationState.sessionId]);

  const handleFinishOffline = useCallback(async () => {
    const bridge = getBridge();
    if (!bridge || actionBusy || !stationState.sessionId) return;
    setRecoveryAction('offline');
    setActionError(null);
    try {
      const result = await bridge.qrStation.finishOffline(stationState.sessionId);
      if (result.ok) {
        setStationState(result.data);
      } else {
        setActionError(result.error.message || 'Could not switch to local Wi-Fi delivery.');
      }
    } catch {
      setActionError('Could not switch to local Wi-Fi delivery.');
    } finally {
      setRecoveryAction(null);
    }
  }, [actionBusy, stationState.sessionId]);

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
    if (!allowsAutoDismiss || !stationState.durationSeconds) return 0;
    return Math.max(0, Math.min(100, (secondsRemaining / stationState.durationSeconds) * 100));
  }, [allowsAutoDismiss, stationState.durationSeconds, secondsRemaining]);

  const holdingForPrint =
    allowsAutoDismiss &&
    stationState.expiresAt === null &&
    isSessionPrintActive(stationState.printStatus);

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
      tone="dark"
      onClose={closeRecentGallery}
    />
  ) : null;

  const printerIndicator = <PrinterIndicator health={printerHealth} />;
  const timer = holdingForPrint ? (
    <div className="qr-station__timer" data-timer-state="holding">
      <span>Holding while printing</span>
    </div>
  ) : stationState.expiresAt !== null ? (
    <div className="qr-station__timer" data-timer-state="counting">
      <span>Clears in {secondsRemaining}s</span>
      <div className="qr-station__timer-bar" aria-hidden="true">
        <div className="qr-station__timer-progress" style={{ width: `${progressPercentage}%` }} />
      </div>
    </div>
  ) : null;

  if (stationState.status === 'error') {
    const showRetry = Boolean(stationState.sessionId && stationState.canRetryUpload);
    const showOffline = Boolean(stationState.sessionId && stationState.canFinishOffline);
    const hasRecoveryActions = showRetry || showOffline;

    return (
      <main className="screen screen--qr-station qr-station--error" data-testid="qr-station-error">
        <div className="qr-station__corner">
          {timer}
          {recentButton}
        </div>
        {printerIndicator}
        <section className="qr-station__message" aria-labelledby="qr-station-error-title">
          <WarningCircle aria-hidden="true" size={56} />
          <h1 id="qr-station-error-title" data-screen-heading tabIndex={-1}>
            Photo delivery unavailable
          </h1>
          <p>{stationState.message ?? 'Ask an operator for help or try another photo session.'}</p>
          <SessionPrintStatus status={stationState.printStatus} tone="dark" />
          {actionError ? (
            <p className="qr-station__action-error" role="alert">
              {actionError}
            </p>
          ) : null}
          <div className="qr-station__actions">
            {showOffline ? (
              <Button
                className="button--station-secondary"
                disabled={actionBusy}
                loading={recoveryAction === 'offline'}
                onClick={() => void handleFinishOffline()}
                variant="secondary"
              >
                Finish offline
              </Button>
            ) : null}
            {showRetry ? (
              <Button
                className="button--station-primary"
                disabled={actionBusy}
                loading={recoveryAction === 'retry'}
                onClick={() => void handleRetryUpload()}
              >
                Retry upload
              </Button>
            ) : null}
            <Button
              className={hasRecoveryActions ? 'button--station-secondary' : 'button--station-done'}
              disabled={actionBusy}
              loading={dismissing}
              onClick={() => void handleDismiss()}
              variant={hasRecoveryActions ? 'secondary' : 'default'}
            >
              Done
            </Button>
          </div>
        </section>
        {recentGallery}
      </main>
    );
  }

  if (stationState.status === 'preparing') {
    const hasCollage = Boolean(stationState.collageUrl);
    return (
      <main
        className="screen screen--qr-station qr-station--preparing"
        data-testid="qr-station-preparing"
        aria-busy="true"
      >
        <div className="qr-station__corner">{recentButton}</div>
        <div className="qr-station__layout">
          <section
            className="final-result qr-station__result"
            aria-label={hasCollage ? 'Your finished photo' : 'Preparing your photo'}
          >
            {stationState.collageUrl ? (
              <Photostrip
                collageUrl={stationState.collageUrl}
                label="Your finished photo"
                variant="collage"
              />
            ) : (
              <div
                className="qr-station__preview-placeholder"
                data-testid="qr-station-preview-placeholder"
                aria-hidden="true"
              >
                <div className="qr-station__preview-shimmer" />
              </div>
            )}
          </section>
          <section className="qr-station__panel" aria-labelledby="qr-station-preparing-title">
            <h1 id="qr-station-preparing-title" data-screen-heading tabIndex={-1}>
              {hasCollage ? (
                <>
                  Photo ready. <span>Finishing your QR code.</span>
                </>
              ) : (
                <>
                  Preparing your photo. <span>Your QR code will appear shortly.</span>
                </>
              )}
            </h1>
            <p>
              {stationState.message ??
                (hasCollage ? 'Uploading for your phone…' : 'Creating your collage…')}
            </p>
            <SessionPrintStatus status={stationState.printStatus} tone="dark" />
            <div className="qr-station__code-placeholder" role="status" aria-live="polite">
              <SpinnerGap aria-hidden="true" className="spin" size={32} />
              <span>Preparing QR code…</span>
            </div>
          </section>
        </div>
        {recentGallery}
        {printerIndicator}
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
          <h1 id="qr-station-idle-title" data-screen-heading tabIndex={-1}>
            Your photo appears here.
          </h1>
          <p>Finish on the main screen, then scan your code right here.</p>
        </section>
        {recentGallery}
        {printerIndicator}
      </main>
    );
  }

  const isOfflineDelivery = stationState.deliveryMode === 'offline';

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
          {isOfflineDelivery ? (
            <p className="qr-station__delivery" data-delivery-mode="offline">
              <WifiHigh aria-hidden="true" size={20} weight="bold" />
              <span>Local Wi-Fi · Connect your phone to the booth Wi-Fi, then scan</span>
            </p>
          ) : (
            <p data-delivery-mode="cloud">Available for 30 days</p>
          )}
          <SessionPrintStatus status={stationState.printStatus} tone="dark" />
          <div className="qr-station__code">
            <img src={stationState.qrImageUrl} alt="QR code for photo download" draggable="false" />
          </div>
          <Button
            className="button--station-done"
            loading={dismissing}
            onClick={() => void handleDismiss()}
          >
            Done
          </Button>
        </section>
      </div>
      {recentGallery}
      {printerIndicator}
    </main>
  );
}
