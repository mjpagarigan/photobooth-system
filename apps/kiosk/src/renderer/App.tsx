import { ArrowClockwise, SpinnerGap } from '@grace-booth/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type {
  AdminHealth,
  AdminSettings as AdminSettingsData,
  BoothSnapshot,
  CameraAdapterKind,
  CameraConfig,
  CameraResolution,
  FrameLayout,
  FrameImportCandidate,
  GalleryItem,
  GraceBoothBridge,
  GuestScreen,
  RpcResult,
  SaveCaptureSettingsInput,
  UploadJobSummary,
} from '@grace-booth/shared';
import {
  CAMERA_ZOOM_DEFAULT,
  isCancellableSessionState,
  isCaptureScreen,
} from '@grace-booth/shared';
import { AnchoredToastProvider, Button, ToastProvider, type DialogTone } from '@grace-booth/ui';

import { AdminSettings } from './admin/AdminSettings';
import { AdminShell } from './admin/AdminShell';
import { FrameEditor } from './admin/FrameEditor';
import { computeDisplayedCountdownSeconds } from './capture-helpers';
import { CameraSetupModal } from './components/CameraSetupModal';
import { FrameImportDialog } from './components/FrameImportDialog';
import { PasscodeDialog } from './components/PasscodeDialog';
import { PrinterIndicator, PrintQueuePanel } from './components/Printing';
import { usePrinterHealth } from './hooks/usePrinterHealth';
import { RecentGallery } from './components/RecentGallery';
import { useCameraStream } from './hooks/useCameraStream';
import { useMidnightRefresh } from './hooks/useMidnightRefresh';
import { useNikonLivePreview } from './hooks/useNikonLivePreview';
import { LOCAL_FIXTURES } from './local-fixtures';
import { AttractScreen } from './screens/AttractScreen';
import { CaptureScreen } from './screens/CaptureScreen';
import { FinalQrScreen } from './screens/FinalQrScreen';
import { ProcessingScreen } from './screens/ProcessingScreen';
import { RecoveryScreen } from './screens/RecoveryScreen';
import { ReviewScreen } from './screens/ReviewScreen';
import {
  EMPTY_BOOTH_SNAPSHOT,
  recoveryVariantFor,
  safeGuestMessage,
  type AdminView,
} from './types';
import type { VisualSeedPayload } from './visual-fixtures';

type DialogState = {
  intent: 'admin' | 'bootstrap' | 'restart';
  mode: 'bootstrap' | 'login' | 'restart';
};

const CANCEL_ARM_WINDOW_MS = 2_000;
const UPLOAD_JOBS_PAGE_LIMIT = 100;
const UPLOAD_JOBS_MAX_PAGES = 10;

async function loadAllUploadJobs(bridge: GraceBoothBridge): Promise<RpcResult<UploadJobSummary[]>> {
  const allJobs: UploadJobSummary[] = [];
  const seenJobIds = new Set<string>();
  const seenCursors = new Set<string>();
  let cursor: string | null = null;

  for (let page = 0; page < UPLOAD_JOBS_MAX_PAGES; page += 1) {
    const result = await bridge.admin.listUploadJobs({
      limit: UPLOAD_JOBS_PAGE_LIMIT,
      cursor,
    });
    if (!result.ok) {
      return result;
    }
    for (const item of result.data.items) {
      if (!seenJobIds.has(item.id)) {
        seenJobIds.add(item.id);
        allJobs.push(item);
      }
    }
    const nextCursor = result.data.nextCursor;
    if (nextCursor === null || seenCursors.has(nextCursor)) {
      break;
    }
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }

  return { ok: true, data: allJobs };
}

const DARK_GUEST_SCREENS = new Set<GuestScreen>([
  'countdown',
  'capturing',
  'shot_review',
  'review',
  'processing',
  'recovery',
]);

function dialogToneForScreen(screen: GuestScreen | null, loading: boolean): DialogTone {
  if (loading || screen === null) {
    return 'light';
  }
  return DARK_GUEST_SCREENS.has(screen) ? 'dark' : 'light';
}

function getBridge(): GraceBoothBridge | null {
  return window.graceBooth ?? null;
}

function adminErrorMessage<T>(result: RpcResult<T>): string {
  if (result.ok) {
    return '';
  }

  if (result.error.message) {
    return result.error.message;
  }

  switch (result.error.code) {
    case 'invalid_request':
      return 'Check the entered values and try again.';
    case 'unauthorized':
    case 'forbidden':
      return 'Operator access has expired. Lock the panel and sign in again.';
    case 'conflict':
      return 'This setting changed elsewhere. Refresh before saving again.';
    case 'rate_limited':
      return 'Too many attempts. Wait a moment, then try again.';
    case 'unavailable':
      return 'The requested service is unavailable right now.';
    default:
      return 'The operation could not be completed safely.';
  }
}

function useCountdown(
  deadline: number | null,
  totalSeconds?: number | null,
  fixedValue?: number,
): number {
  const [seconds, setSeconds] = useState(() =>
    computeDisplayedCountdownSeconds(deadline, totalSeconds),
  );
  const nextKey = `${deadline ?? 'none'}:${totalSeconds ?? 'none'}`;
  const [prevKey, setPrevKey] = useState(nextKey);

  if (prevKey !== nextKey) {
    setPrevKey(nextKey);
    setSeconds(computeDisplayedCountdownSeconds(deadline, totalSeconds));
  }

  useEffect(() => {
    if (fixedValue !== undefined || deadline === null) {
      return;
    }

    const update = () => {
      setSeconds(computeDisplayedCountdownSeconds(deadline, totalSeconds));
    };
    update();
    const interval = window.setInterval(update, 100);
    return () => {
      window.clearInterval(interval);
    };
  }, [deadline, fixedValue, totalSeconds]);

  return fixedValue ?? seconds;
}

export function App() {
  const [snapshot, setSnapshot] = useState<BoothSnapshot>(EMPTY_BOOTH_SNAPSHOT);
  const [loading, setLoading] = useState(true);
  const [guestBusy, setGuestBusy] = useState(false);
  const [guestError, setGuestError] = useState<string | null>(null);
  const [adminOpen, setAdminOpen] = useState(false);
  const [adminView, setAdminView] = useState<AdminView>('frame');
  const [adminSettings, setAdminSettings] = useState<AdminSettingsData | null>(null);
  const [health, setHealth] = useState<AdminHealth | null>(null);
  const [jobs, setJobs] = useState<UploadJobSummary[]>([]);
  const [adminBusy, setAdminBusy] = useState(false);
  const [adminError, setAdminError] = useState<string | null>(null);
  const [adminStatus, setAdminStatus] = useState<string | null>(null);
  const [frameImportCandidate, setFrameImportCandidate] = useState<FrameImportCandidate | null>(
    null,
  );
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [dialogBusy, setDialogBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [cameraSetupOpen, setCameraSetupOpen] = useState(false);
  const [selectedCameraAdapter, setSelectedCameraAdapter] = useState<CameraAdapterKind>('webcam');
  const [selectedCameraDeviceId, setSelectedCameraDeviceId] = useState<string | null>(null);
  const [selectedCameraResolution, setSelectedCameraResolution] =
    useState<CameraResolution>('1080p');
  const [cameraZoomPercent, setCameraZoomPercent] = useState(CAMERA_ZOOM_DEFAULT);
  const [webcamAlwaysActive, setWebcamAlwaysActive] = useState(false);
  const [cancelArmed, setCancelArmed] = useState(false);
  const [recent, setRecent] = useState<{
    open: boolean;
    busy: boolean;
    items: GalleryItem[];
    error: string | null;
  }>({ open: false, busy: false, items: [], error: null });
  const [repairingSessionId, setRepairingSessionId] = useState<string | null>(null);
  const [visualSeed, setVisualSeed] = useState<VisualSeedPayload | null>(null);
  const livePrinterHealth = usePrinterHealth();
  const printerHealth = visualSeed?.printerHealth ?? livePrinterHealth;
  const countdownAudioRef = useRef<HTMLAudioElement | null>(null);
  const shutterAudioRef = useRef<HTMLAudioElement | null>(null);
  const audioArmedRef = useRef(false);
  const lastCueRef = useRef<number | null>(null);
  const lastStateRef = useRef(snapshot.state);
  const cancelArmedRef = useRef(false);
  const cancelDisarmTimerRef = useRef<number | null>(null);
  const recentRequestIdRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const countdownSeconds = useCountdown(
    snapshot.state === 'countdown' ? snapshot.countdownEndsAt : null,
    snapshot.state === 'countdown' ? snapshot.countdownTotalSeconds : null,
    visualSeed?.countdownSeconds,
  );

  const captureWindowOpen = isCaptureScreen(snapshot.screen);
  const liveShotPhaseOpen = snapshot.screen === 'countdown' || snapshot.screen === 'capturing';
  const guestFlowOpen = !adminOpen && !dialog && !cameraSetupOpen;
  const isNikonAdapter = selectedCameraAdapter === 'nikon';
  const webcamCameraEnabled =
    !visualSeed &&
    snapshot.cameraPreviewEnabled &&
    guestFlowOpen &&
    !isNikonAdapter &&
    (captureWindowOpen || webcamAlwaysActive);
  const nikonPreviewEnabled =
    !visualSeed &&
    snapshot.cameraPreviewEnabled &&
    guestFlowOpen &&
    liveShotPhaseOpen &&
    isNikonAdapter;
  const camera = useCameraStream(
    webcamCameraEnabled,
    selectedCameraDeviceId,
    selectedCameraResolution,
    cameraZoomPercent,
  );
  const nikonPreview = useNikonLivePreview(nikonPreviewEnabled);
  const grabJpegBase64 = camera.grabJpegBase64;

  useEffect(() => {
    if (!webcamCameraEnabled) {
      return;
    }
    const bridge = getBridge();
    if (!bridge) {
      return;
    }
    return bridge.booth.onCameraFrameRequest((request) => {
      const jpegBase64 = grabJpegBase64();
      if (!jpegBase64) {
        return;
      }
      void bridge.booth.submitCameraFrame(request.captureId, jpegBase64).catch(() => undefined);
    });
  }, [grabJpegBase64, webcamCameraEnabled]);

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;

    const initialize = async () => {
      if (import.meta.env.DEV) {
        const { readVisualFixture } = await import('./visual-fixtures');
        const fixture = await readVisualFixture(window.location.search);
        if (!active) {
          return;
        }
        if (fixture) {
          setVisualSeed(fixture);
          setSnapshot(fixture.snapshot);
          setAdminSettings(fixture.settings);
          setHealth(fixture.health);
          setJobs(fixture.jobs);
          setAdminBusy(fixture.operatorBusy ?? false);
          setAdminError(fixture.operatorError ?? null);
          setAdminStatus(fixture.operatorStatus ?? null);
          setRecent({
            open: false,
            busy: false,
            items: fixture.recentItems ?? [],
            error: null,
          });
          setDialog(fixture.dialog ?? null);
          setCameraSetupOpen(fixture.cameraSetupOpen ?? false);
          if (fixture.adminView) {
            setAdminView(fixture.adminView);
            setAdminOpen(true);
          }
          setLoading(false);
          return;
        }
      }

      const bridge = getBridge();
      if (!bridge) {
        if (active) {
          setSnapshot({
            ...EMPTY_BOOTH_SNAPSHOT,
            screen: 'recovery',
            state: 'interrupted',
            errorCode: 'interrupted',
            message: 'The booth connection is starting. Ask an operator if this screen remains.',
          });
          setLoading(false);
        }
        return;
      }

      try {
        unsubscribe = bridge.booth.subscribe((nextSnapshot) => {
          if (active) {
            setSnapshot(nextSnapshot);
            setGuestError(null);
          }
        });
        const [result, authStatus, cameraConfig] = await Promise.all([
          bridge.booth.getSnapshot(),
          bridge.admin.getAuthStatus(),
          bridge.booth.getCameras().catch(() => null),
        ]);
        if (!active) {
          return;
        }
        if (cameraConfig?.ok) {
          setSelectedCameraAdapter(cameraConfig.data.adapter);
          setSelectedCameraDeviceId(cameraConfig.data.deviceId);
          setSelectedCameraResolution(cameraConfig.data.resolution);
          setCameraZoomPercent(cameraConfig.data.zoomPercent);
          setWebcamAlwaysActive(cameraConfig.data.alwaysActive);
        }
        if (result.ok) {
          setSnapshot(result.data);
        } else {
          setSnapshot({
            ...EMPTY_BOOTH_SNAPSHOT,
            screen: 'recovery',
            state: 'interrupted',
            errorCode: 'interrupted',
            message: 'The booth could not restore its last session. Ask an operator for help.',
          });
        }
        if (authStatus.ok && !authStatus.data.configured) {
          setDialog({ intent: 'bootstrap', mode: 'bootstrap' });
          setDialogError(null);
        } else if (!authStatus.ok) {
          setSnapshot({
            ...EMPTY_BOOTH_SNAPSHOT,
            screen: 'recovery',
            state: 'interrupted',
            errorCode: 'operator_required',
            message: 'Operator setup could not be verified. Ask an operator for help.',
          });
        }
      } catch (err) {
        console.error('Failed to initialize booth:', err);
        if (active) {
          setSnapshot({
            ...EMPTY_BOOTH_SNAPSHOT,
            screen: 'recovery',
            state: 'interrupted',
            errorCode: 'interrupted',
            message: 'The booth connection failed to initialize. Please restart the booth.',
          });
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    void initialize();
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    const focusTarget = window.setTimeout(() => {
      document.querySelector<HTMLElement>('[data-screen-heading]')?.focus();
    }, 0);
    return () => window.clearTimeout(focusTarget);
  }, [adminOpen, adminView, snapshot.screen, snapshot.state]);

  const prepareAudio = useCallback(() => {
    if (audioArmedRef.current || typeof Audio === 'undefined') {
      return;
    }
    const countdownAudio = countdownAudioRef.current ?? new Audio(LOCAL_FIXTURES.countdownAudio);
    const shutterAudio = shutterAudioRef.current ?? new Audio(LOCAL_FIXTURES.shutterAudio);
    countdownAudio.preload = 'auto';
    shutterAudio.preload = 'auto';
    countdownAudio.load();
    shutterAudio.load();
    countdownAudioRef.current = countdownAudio;
    shutterAudioRef.current = shutterAudio;
    audioArmedRef.current = true;
  }, []);

  useEffect(() => {
    if (visualSeed || !audioArmedRef.current) {
      lastStateRef.current = snapshot.state;
      return;
    }

    if (snapshot.state === 'countdown' && lastCueRef.current !== countdownSeconds) {
      lastCueRef.current = countdownSeconds;
      const audio = countdownAudioRef.current;
      if (audio) {
        audio.currentTime = 0;
        void audio.play().catch(() => undefined);
      }
    }

    if (snapshot.state === 'capturing' && lastStateRef.current !== 'capturing') {
      const audio = shutterAudioRef.current;
      if (audio) {
        audio.currentTime = 0;
        void audio.play().catch(() => undefined);
      }
    }

    if (snapshot.state !== 'countdown') {
      lastCueRef.current = null;
    }
    lastStateRef.current = snapshot.state;
  }, [countdownSeconds, snapshot.state, visualSeed]);

  const runGuestCommand = useCallback(
    async (command: (bridge: GraceBoothBridge) => Promise<RpcResult<BoothSnapshot>>) => {
      if (visualSeed) {
        return;
      }
      const bridge = getBridge();
      if (!bridge) {
        setGuestError('The booth controls are unavailable. Ask an operator for help.');
        return;
      }
      setGuestBusy(true);
      setGuestError(null);
      try {
        const result = await command(bridge);
        if (result.ok) {
          setSnapshot(result.data);
        } else {
          setGuestError(
            safeGuestMessage(
              result.error.message,
              'That action could not be completed. Please try again.',
            ),
          );
        }
      } catch {
        setGuestError('That action could not be completed. Please try again.');
      } finally {
        setGuestBusy(false);
      }
    },
    [visualSeed],
  );

  const startGuestSession = useCallback(() => {
    prepareAudio();
    void runGuestCommand((bridge) => bridge.booth.start());
  }, [prepareAudio, runGuestCommand]);

  const acceptShot = useCallback(
    (shotNumber: number) => {
      prepareAudio();
      void runGuestCommand((bridge) => bridge.booth.acceptShot(shotNumber));
    },
    [prepareAudio, runGuestCommand],
  );

  const retakeShot = useCallback(
    (shotNumber: number) => {
      prepareAudio();
      void runGuestCommand((bridge) => bridge.booth.retakeShot(shotNumber));
    },
    [prepareAudio, runGuestCommand],
  );

  const retakeAll = useCallback(() => {
    prepareAudio();
    void runGuestCommand((bridge) => bridge.booth.retakeAll());
  }, [prepareAudio, runGuestCommand]);

  const refreshAdminData = useCallback(async (): Promise<boolean> => {
    if (visualSeed) {
      return true;
    }
    const bridge = getBridge();
    if (!bridge) {
      setAdminError('The local operator service is unavailable.');
      return false;
    }
    setAdminBusy(true);
    setAdminError(null);
    try {
      const [settingsResult, healthResult, jobsResult] = await Promise.all([
        bridge.admin.getSettings(),
        bridge.admin.getHealth(),
        loadAllUploadJobs(bridge),
      ]);
      const failed = [settingsResult, healthResult, jobsResult].find((result) => !result.ok);
      if (failed) {
        setAdminError(adminErrorMessage(failed));
        return false;
      }
      if (settingsResult.ok && healthResult.ok && jobsResult.ok) {
        setAdminSettings(settingsResult.data);
        setHealth(healthResult.data);
        setJobs(jobsResult.data);
        return true;
      }
      return false;
    } catch {
      setAdminError('The operator panel could not load its local data.');
      return false;
    } finally {
      setAdminBusy(false);
    }
  }, [visualSeed]);

  const handleCameraSaved = (config: CameraConfig) => {
    setSelectedCameraAdapter(config.adapter);
    setSelectedCameraDeviceId(config.deviceId);
    setSelectedCameraResolution(config.resolution);
    setCameraZoomPercent(config.zoomPercent);
    setWebcamAlwaysActive(config.alwaysActive);
    void refreshAdminData();
  };

  const restartSession = useCallback(async () => {
    if (!snapshot.sessionId || visualSeed) {
      return;
    }
    const bridge = getBridge();
    if (!bridge) {
      setGuestError('The operator restart is unavailable.');
      return;
    }
    setDialogBusy(true);
    setDialogError(null);
    try {
      const result = await bridge.admin.restartSession(snapshot.sessionId);
      if (result.ok) {
        setSnapshot(result.data);
        setDialog(null);
      } else {
        setDialogError(adminErrorMessage(result));
      }
    } catch {
      setDialogError('The session could not be restarted safely.');
    } finally {
      setDialogBusy(false);
    }
  }, [snapshot.sessionId, visualSeed]);

  const beginProtectedAction = useCallback(
    async (intent: DialogState['intent']) => {
      if (visualSeed) {
        return;
      }
      const bridge = getBridge();
      if (!bridge) {
        setGuestError('Operator access is unavailable.');
        return;
      }
      setGuestBusy(true);
      setGuestError(null);
      try {
        const result = await bridge.admin.getAuthStatus();
        if (!result.ok) {
          setGuestError('Operator access could not be checked.');
          return;
        }
        if (!result.data.configured) {
          setDialog({ intent, mode: 'bootstrap' });
          setDialogError(null);
          return;
        }
        if (result.data.authenticated) {
          if (intent === 'restart') {
            await restartSession();
          } else if (await refreshAdminData()) {
            setAdminOpen(true);
          }
          return;
        }
        setDialog({ intent, mode: intent === 'restart' ? 'restart' : 'login' });
        setDialogError(null);
      } catch {
        setGuestError('Operator access could not be checked.');
      } finally {
        setGuestBusy(false);
      }
    },
    [refreshAdminData, restartSession, visualSeed],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'a') {
        event.preventDefault();
        void beginProtectedAction('admin');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [beginProtectedAction]);

  // Guest cancellation: the first ESC arms and shows a hint, a second ESC inside the window
  // aborts the live session. Modal/dialog ESC handlers take precedence — when one is open this
  // listener is inactive so ESC only closes the modal.
  const sessionCancellable =
    !visualSeed &&
    !loading &&
    !adminOpen &&
    !dialog &&
    !cameraSetupOpen &&
    !recent.open &&
    isCancellableSessionState(snapshot.state);

  useEffect(() => {
    if (!sessionCancellable) {
      cancelArmedRef.current = false;
      setCancelArmed(false);
      if (cancelDisarmTimerRef.current !== null) {
        window.clearTimeout(cancelDisarmTimerRef.current);
        cancelDisarmTimerRef.current = null;
      }
      return;
    }
    const disarm = () => {
      cancelArmedRef.current = false;
      setCancelArmed(false);
      if (cancelDisarmTimerRef.current !== null) {
        window.clearTimeout(cancelDisarmTimerRef.current);
        cancelDisarmTimerRef.current = null;
      }
    };
    const handleCancelKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      if (!cancelArmedRef.current) {
        cancelArmedRef.current = true;
        setCancelArmed(true);
        cancelDisarmTimerRef.current = window.setTimeout(disarm, CANCEL_ARM_WINDOW_MS);
        return;
      }
      disarm();
      void runGuestCommand((bridge) => bridge.booth.cancelSession());
    };
    window.addEventListener('keydown', handleCancelKeyDown);
    return () => window.removeEventListener('keydown', handleCancelKeyDown);
  }, [runGuestCommand, sessionCancellable]);

  const submitPasscode = useCallback(
    async (passcode: string) => {
      if (!dialog) {
        return;
      }
      const bridge = getBridge();
      if (!bridge) {
        setDialogError('Operator access is unavailable.');
        return;
      }
      setDialogBusy(true);
      setDialogError(null);
      try {
        const result =
          dialog.mode === 'bootstrap'
            ? await bridge.admin.bootstrapPasscode(passcode)
            : await bridge.admin.login(passcode);
        if (!result.ok) {
          setDialogError(adminErrorMessage(result));
          return;
        }
        if (dialog.intent === 'bootstrap') {
          await bridge.admin.logout();
          setDialog(null);
        } else if (dialog.intent === 'restart') {
          await restartSession();
        } else if (await refreshAdminData()) {
          setDialog(null);
          setAdminOpen(true);
        }
      } catch {
        setDialogError('Operator access could not be unlocked.');
      } finally {
        setDialogBusy(false);
      }
    },
    [dialog, refreshAdminData, restartSession],
  );

  const exitAdmin = useCallback(async () => {
    recentRequestIdRef.current += 1;
    if (!visualSeed) {
      const bridge = getBridge();
      if (bridge) {
        await bridge.admin.logout().catch(() => undefined);
      }
      setRecent({ open: false, busy: false, items: [], error: null });
    }
    setAdminOpen(false);
    setAdminError(null);
    setAdminStatus(null);
  }, [visualSeed]);

  const saveFrame = useCallback(
    async (frameId: string, name: string, slots: FrameLayout, expectedRevision: number) => {
      if (!adminSettings || visualSeed) {
        return;
      }
      const bridge = getBridge();
      if (!bridge) {
        return;
      }
      setAdminBusy(true);
      setAdminError(null);
      setAdminStatus(null);
      try {
        const result = await bridge.admin.updateFrameLayout({
          frameId,
          name,
          slots,
          expectedRevision,
        });
        if (result.ok) {
          await refreshAdminData();
          setAdminStatus('Frame layout saved.');
        } else {
          setAdminError(adminErrorMessage(result));
        }
      } finally {
        setAdminBusy(false);
      }
    },
    [adminSettings, refreshAdminData, visualSeed],
  );

  const addFrame = useCallback(async () => {
    if (visualSeed) {
      return;
    }
    const bridge = getBridge();
    if (!bridge) {
      return;
    }
    setAdminBusy(true);
    setAdminError(null);
    setAdminStatus(null);
    try {
      const selection = await bridge.admin.chooseFrame();
      if (!selection.ok) {
        setAdminError(adminErrorMessage(selection));
        return;
      }
      if (!selection.data) return;
      setFrameImportCandidate(selection.data);
    } finally {
      setAdminBusy(false);
    }
  }, [visualSeed]);

  const confirmAddFrame = useCallback(
    async (name: string, shotCount: number) => {
      if (!frameImportCandidate || visualSeed) return;
      const bridge = getBridge();
      if (!bridge) return;
      setAdminBusy(true);
      setAdminError(null);
      try {
        const result = await bridge.admin.addFrame({
          candidateId: frameImportCandidate.candidateId,
          name,
          shotCount,
        });
        if (result.ok) {
          if (result.data) {
            setFrameImportCandidate(null);
            await refreshAdminData();
            setAdminStatus('Transparent frame added to the library. Review the slots, then save.');
          }
        } else {
          setAdminError(adminErrorMessage(result));
        }
      } finally {
        setAdminBusy(false);
      }
    },
    [frameImportCandidate, refreshAdminData, visualSeed],
  );

  const deleteFrame = useCallback(
    async (frameId: string) => {
      if (visualSeed) {
        return;
      }
      const bridge = getBridge();
      if (!bridge) {
        return;
      }
      setAdminBusy(true);
      setAdminError(null);
      setAdminStatus(null);
      try {
        const result = await bridge.admin.deleteFrame(frameId);
        if (result.ok) {
          await refreshAdminData();
          setAdminStatus('Frame deleted from the library.');
        } else {
          setAdminError(adminErrorMessage(result));
        }
      } finally {
        setAdminBusy(false);
      }
    },
    [refreshAdminData, visualSeed],
  );

  const activateFrame = useCallback(
    async (frameId: string) => {
      if (visualSeed) return;
      const bridge = getBridge();
      if (!bridge) return;
      setAdminBusy(true);
      setAdminError(null);
      setAdminStatus(null);
      try {
        const result = await bridge.admin.activateFrame(frameId);
        if (result.ok) {
          await refreshAdminData();
          setAdminStatus('Frame will be used for new sessions.');
        } else setAdminError(adminErrorMessage(result));
      } finally {
        setAdminBusy(false);
      }
    },
    [refreshAdminData, visualSeed],
  );

  const moveFrame = useCallback(
    async (frameId: string, direction: 'up' | 'down') => {
      if (visualSeed) {
        return;
      }
      const bridge = getBridge();
      if (!bridge) {
        return;
      }
      setAdminBusy(true);
      setAdminError(null);
      setAdminStatus(null);
      try {
        const result = await bridge.admin.moveFrame({ frameId, direction });
        if (result.ok) {
          await refreshAdminData();
        } else {
          setAdminError(adminErrorMessage(result));
        }
      } finally {
        setAdminBusy(false);
      }
    },
    [refreshAdminData, visualSeed],
  );

  const saveSettings = useCallback(
    async (input: Parameters<GraceBoothBridge['admin']['saveSettings']>[0]) => {
      if (visualSeed) {
        return;
      }
      const bridge = getBridge();
      if (!bridge) {
        return;
      }
      setAdminBusy(true);
      setAdminError(null);
      setAdminStatus(null);
      try {
        const result = await bridge.admin.saveSettings(input);
        if (result.ok) {
          setAdminSettings(result.data);
          setAdminStatus('Settings saved.');
        } else {
          setAdminError(adminErrorMessage(result));
        }
      } finally {
        setAdminBusy(false);
      }
    },
    [visualSeed],
  );

  const saveCaptureSettings = useCallback(
    async (input: SaveCaptureSettingsInput) => {
      if (visualSeed) {
        return;
      }
      const bridge = getBridge();
      if (!bridge) {
        return;
      }
      setAdminBusy(true);
      setAdminError(null);
      setAdminStatus(null);
      try {
        const result = await bridge.admin.saveCaptureSettings(input);
        if (result.ok) {
          setAdminSettings(result.data);
          setAdminStatus('Capture settings saved.');
        } else {
          setAdminError(adminErrorMessage(result));
        }
      } finally {
        setAdminBusy(false);
      }
    },
    [visualSeed],
  );

  const retryJob = useCallback(
    async (jobId: string) => {
      if (visualSeed) {
        return;
      }
      const bridge = getBridge();
      if (!bridge) {
        return;
      }
      setAdminBusy(true);
      setAdminError(null);
      setAdminStatus(null);
      try {
        const result = await bridge.admin.retryUpload(jobId);
        if (result.ok) {
          setJobs((current) =>
            current.map((job) => (job.id === result.data.id ? result.data : job)),
          );
          setAdminStatus('Upload queued for another secure attempt.');
        } else {
          setAdminError(adminErrorMessage(result));
        }
      } finally {
        setAdminBusy(false);
      }
    },
    [visualSeed],
  );

  const changePasscode = useCallback(
    async (currentPasscode: string, newPasscode: string) => {
      if (visualSeed) {
        return;
      }
      const bridge = getBridge();
      if (!bridge) {
        return;
      }
      setAdminBusy(true);
      setAdminError(null);
      setAdminStatus(null);
      try {
        const result = await bridge.admin.changePasscode(currentPasscode, newPasscode);
        if (result.ok) {
          setAdminSettings(null);
          setAdminOpen(false);
          setAdminStatus(null);
          setAdminError(null);
        } else {
          setAdminError(adminErrorMessage(result));
        }
      } finally {
        setAdminBusy(false);
      }
    },
    [visualSeed],
  );

  const connectCloud = useCallback(
    async (
      email: string,
      password: string,
      supabaseUrl?: string | null,
      supabasePublishableKey?: string | null,
    ) => {
      if (visualSeed) {
        return;
      }
      const bridge = getBridge();
      if (!bridge) {
        return;
      }
      setAdminBusy(true);
      setAdminError(null);
      setAdminStatus(null);
      try {
        const result = await bridge.admin.connectCloud(
          email,
          password,
          supabaseUrl,
          supabasePublishableKey,
        );
        if (result.ok) {
          setAdminStatus('Cloud account connected securely.');
          await refreshAdminData();
        } else {
          setAdminError(adminErrorMessage(result));
        }
      } finally {
        setAdminBusy(false);
      }
    },
    [refreshAdminData, visualSeed],
  );

  const chooseLanCertificate = useCallback(
    async (passphrase: string) => {
      if (visualSeed) {
        return;
      }
      const bridge = getBridge();
      if (!bridge) {
        return;
      }
      setAdminBusy(true);
      setAdminError(null);
      setAdminStatus(null);
      try {
        const result = await bridge.admin.chooseLanCertificate(passphrase);
        if (result.ok) {
          setAdminStatus(result.data?.message ?? 'Certificate selection was cancelled.');
          if (result.data) {
            await refreshAdminData();
          }
        } else {
          setAdminError(adminErrorMessage(result));
        }
      } finally {
        setAdminBusy(false);
      }
    },
    [refreshAdminData, visualSeed],
  );

  const openRecentGallery = useCallback(async () => {
    if (visualSeed) {
      setRecent((current) => ({ ...current, open: true }));
      return;
    }
    const bridge = getBridge();
    if (!bridge) {
      setRecent({
        open: true,
        busy: false,
        items: [],
        error: 'The booth controls are unavailable.',
      });
      return;
    }
    const requestId = ++recentRequestIdRef.current;
    setRecent({ open: true, busy: true, items: [], error: null });
    try {
      const result = await bridge.gallery.getRecent();
      if (!mountedRef.current || recentRequestIdRef.current !== requestId) {
        return;
      }
      if (result.ok) {
        setRecent({ open: true, busy: false, items: result.data, error: null });
      } else {
        setRecent({
          open: true,
          busy: false,
          items: [],
          error: safeGuestMessage(result.error.message, 'Recent photos could not be loaded.'),
        });
      }
    } catch {
      if (!mountedRef.current || recentRequestIdRef.current !== requestId) {
        return;
      }
      setRecent({
        open: true,
        busy: false,
        items: [],
        error: 'Recent photos could not be loaded.',
      });
    }
  }, [visualSeed]);

  const loadOperatorGallery = useCallback(
    async (options?: { refresh?: boolean }) => {
      if (visualSeed) {
        return;
      }
      const refresh = options?.refresh === true;
      const bridge = getBridge();
      if (!bridge) {
        setRecent((curr) => ({
          ...curr,
          busy: false,
          items: refresh ? curr.items : [],
          error: 'The booth controls are unavailable.',
        }));
        return;
      }
      const requestId = ++recentRequestIdRef.current;
      setRecent((curr) => ({
        ...curr,
        busy: true,
        items: refresh ? curr.items : [],
        error: null,
      }));
      try {
        const [galleryResult, jobsResult] = await Promise.allSettled([
          refresh ? bridge.gallery.getRecent({ refresh: true }) : bridge.gallery.getRecent(),
          loadAllUploadJobs(bridge),
        ]);
        if (!mountedRef.current || recentRequestIdRef.current !== requestId) {
          return;
        }
        if (jobsResult.status === 'fulfilled' && jobsResult.value.ok) {
          setJobs(jobsResult.value.data);
        }
        if (galleryResult.status !== 'fulfilled') {
          setRecent((curr) => ({
            ...curr,
            busy: false,
            items: refresh ? curr.items : [],
            error: 'Recent photos could not be loaded.',
          }));
          return;
        }
        const result = galleryResult.value;
        if (result.ok) {
          setRecent((curr) => ({ ...curr, busy: false, items: result.data, error: null }));
        } else {
          setRecent((curr) => ({
            ...curr,
            busy: false,
            items: refresh ? curr.items : [],
            error: safeGuestMessage(result.error.message, 'Recent photos could not be loaded.'),
          }));
        }
      } catch {
        if (!mountedRef.current || recentRequestIdRef.current !== requestId) {
          return;
        }
        setRecent((curr) => ({
          ...curr,
          busy: false,
          items: refresh ? curr.items : [],
          error: 'Recent photos could not be loaded.',
        }));
      }
    },
    [visualSeed],
  );

  const closeRecentGallery = useCallback(() => {
    recentRequestIdRef.current += 1;
    setRecent((current) => ({ ...current, open: false, busy: false }));
  }, []);

  const repairCloudPhoto = useCallback(
    async (sessionId: string) => {
      if (visualSeed) {
        return;
      }
      const bridge = getBridge();
      if (!bridge) {
        setRecent((curr) => ({
          ...curr,
          error: 'The local operator service is unavailable.',
        }));
        return;
      }
      setRepairingSessionId(sessionId);
      setRecent((curr) => ({ ...curr, error: null }));
      try {
        const result = await bridge.gallery.repairCloudPhoto(sessionId);
        if (!result.ok) {
          setRecent((curr) => ({ ...curr, error: adminErrorMessage(result) }));
          return;
        }
        await loadOperatorGallery({ refresh: true });
        if (result.data.status !== 'repaired') {
          setRecent((curr) => ({ ...curr, error: result.data.message }));
        }
      } catch {
        setRecent((curr) => ({
          ...curr,
          error: 'The cloud copy could not be repaired safely.',
        }));
      } finally {
        setRepairingSessionId(null);
      }
    },
    [loadOperatorGallery, visualSeed],
  );

  // Auto-load the operator gallery when its panel view is opened.
  useEffect(() => {
    if (adminOpen && adminView === 'gallery') {
      void loadOperatorGallery();
      return () => {
        recentRequestIdRef.current += 1;
      };
    }
    return undefined;
  }, [adminOpen, adminView, loadOperatorGallery]);

  const guestGalleryOpen = !visualSeed && recent.open && !adminOpen;
  const operatorGalleryOpen = !visualSeed && adminOpen && adminView === 'gallery';

  useMidnightRefresh(guestGalleryOpen || operatorGalleryOpen, () => {
    if (operatorGalleryOpen) {
      void loadOperatorGallery();
    } else {
      void openRecentGallery();
    }
  });

  const guestContent = useMemo(() => {
    if (loading) {
      return (
        <main className="screen screen--loading" data-testid="renderer-loading" role="status">
          <SpinnerGap aria-hidden="true" weight="bold" />
          <span>Starting photobooth…</span>
        </main>
      );
    }

    if (snapshot.screen === 'attract') {
      const attractCameraMessage =
        guestError ??
        (!snapshot.controls.canStart && snapshot.message
          ? safeGuestMessage(snapshot.message, 'The booth is getting ready.')
          : null);
      return (
        <AttractScreen
          busy={guestBusy}
          cameraMessage={attractCameraMessage}
          canStart={snapshot.controls.canStart}
          onOpenAdmin={() => void beginProtectedAction('admin')}
          onOpenCameras={() => setCameraSetupOpen(true)}
          onOpenRecent={() => void openRecentGallery()}
          onStart={startGuestSession}
          shotCount={snapshot.requiredShotCount ?? 3}
        />
      );
    }

    if (isCaptureScreen(snapshot.screen)) {
      const totalShots = snapshot.requiredShotCount ?? 3;
      const shotNumber = snapshot.shotNumber ?? Math.min(totalShots, snapshot.captureCount + 1);
      const sharedProps = {
        shotNumber,
        totalShots,
        ...(nikonPreviewEnabled
          ? {
              liveImageUrl: nikonPreview.frameUrl,
              liveStreamReady: nikonPreview.ready,
              cameraZoomPercent: 100,
            }
          : webcamCameraEnabled
            ? {
                liveVideoRef: camera.videoRef,
                liveStreamReady: camera.ready,
                cameraZoomPercent,
              }
            : { cameraZoomPercent }),
      };

      if (snapshot.screen === 'shot_review') {
        const capturedPhotoUrl = snapshot.media.captureUrls[shotNumber - 1] ?? null;
        return (
          <CaptureScreen
            {...sharedProps}
            phase="shot_review"
            busy={guestBusy}
            canAcceptShot={snapshot.controls.canAcceptShot}
            canRetakeShot={snapshot.controls.canRetakeShot}
            capturedPhotoUrl={capturedPhotoUrl}
            captureUrls={snapshot.media.captureUrls}
            errorMessage={guestError}
            onAcceptShot={() => acceptShot(shotNumber)}
            onRetakeShot={() => retakeShot(shotNumber)}
          />
        );
      }

      if (snapshot.screen === 'capturing') {
        return <CaptureScreen {...sharedProps} phase="capturing" />;
      }

      return (
        <CaptureScreen {...sharedProps} phase="countdown" secondsRemaining={countdownSeconds} />
      );
    }

    if (snapshot.screen === 'review') {
      return (
        <ReviewScreen
          busy={guestBusy}
          canAccept={snapshot.controls.canAcceptPhotos}
          canRetake={snapshot.controls.canRetakeAll}
          captureUrls={snapshot.media.captureUrls}
          frames={snapshot.media.frames}
          printerHealth={printerHealth}
          onAccept={(frameId, print) =>
            void runGuestCommand((bridge) => bridge.booth.acceptPhotos({ frameId, print }))
          }
          onRetake={retakeAll}
        />
      );
    }

    if (snapshot.screen === 'processing') {
      return (
        <ProcessingScreen
          message={safeGuestMessage(
            snapshot.message,
            'Your finished photo is being prepared safely.',
          )}
          onOpenAdmin={() => void beginProtectedAction('admin')}
          printStatus={snapshot.printStatus ?? null}
          state={snapshot.state}
          totalShots={snapshot.requiredShotCount ?? 3}
        />
      );
    }

    if (
      snapshot.screen === 'final' &&
      snapshot.state === 'final' &&
      snapshot.media.collageUrl &&
      snapshot.media.qrImageUrl
    ) {
      return (
        <FinalQrScreen
          busy={guestBusy}
          cloudRetentionDays={adminSettings?.cloudRetentionDays ?? 30}
          collageUrl={snapshot.media.collageUrl}
          deliveryMode={snapshot.deliveryMode ?? 'cloud'}
          onDone={() => void runGuestCommand((bridge) => bridge.booth.done())}
          onOpenRecent={() => void openRecentGallery()}
          printStatus={snapshot.printStatus ?? null}
          qrImageUrl={snapshot.media.qrImageUrl}
        />
      );
    }

    const variant = recoveryVariantFor(snapshot.state, snapshot.errorCode);
    const fallback =
      variant === 'upload'
        ? 'Your photo is safe on this booth. Try the secure upload again.'
        : variant === 'camera'
          ? 'The camera needs an operator check before this session can continue.'
          : 'Your saved work is being checked so the booth can continue safely.';
    return (
      <RecoveryScreen
        busy={guestBusy}
        canRetryUpload={snapshot.controls.canRetryUpload}
        canFinishOffline={snapshot.controls.canFinishOffline}
        message={safeGuestMessage(guestError ?? snapshot.message, fallback)}
        onOpenAdmin={() => void beginProtectedAction('admin')}
        onRestart={() => void beginProtectedAction('restart')}
        onRetryUpload={() => void runGuestCommand((bridge) => bridge.booth.retryUpload())}
        onFinishOffline={() => void runGuestCommand((bridge) => bridge.booth.finishOffline())}
        printStatus={snapshot.printStatus ?? null}
        variant={variant}
      />
    );
  }, [
    acceptShot,
    adminSettings?.cloudRetentionDays,
    beginProtectedAction,
    camera.ready,
    camera.videoRef,
    cameraZoomPercent,
    countdownSeconds,
    guestBusy,
    guestError,
    loading,
    nikonPreview.frameUrl,
    nikonPreview.ready,
    nikonPreviewEnabled,
    openRecentGallery,
    printerHealth,
    retakeAll,
    retakeShot,
    runGuestCommand,
    startGuestSession,
    snapshot,
    webcamCameraEnabled,
  ]);

  if (adminOpen && adminSettings) {
    return (
      <ToastProvider>
        <AnchoredToastProvider>
          <>
            <AdminShell
              onExit={() => void exitAdmin()}
              onViewChange={setAdminView}
              view={adminView}
            >
              {adminView === 'frame' ? (
                <FrameEditor
                  busy={adminBusy}
                  error={adminError}
                  frames={adminSettings.frames ?? [adminSettings.activeFrame]}
                  onAddFrame={() => void addFrame()}
                  onActivateFrame={(frameId) => void activateFrame(frameId)}
                  onDeleteFrame={(frameId) => void deleteFrame(frameId)}
                  onMoveFrame={(frameId, direction) => void moveFrame(frameId, direction)}
                  onSave={(frameId, name, slots, expectedRevision) =>
                    void saveFrame(frameId, name, slots, expectedRevision)
                  }
                  status={adminStatus}
                />
              ) : adminView === 'gallery' ? (
                <section className="admin-page" aria-label="Recent photos">
                  <header className="admin-page-header">
                    <div>
                      <h1 data-screen-heading tabIndex={-1}>
                        Recent photos
                      </h1>
                      <p>Today's finished collages with delivery status and metadata.</p>
                    </div>
                    <div className="admin-page-header__actions">
                      <Button
                        icon={<ArrowClockwise aria-hidden="true" weight="bold" />}
                        loading={recent.busy}
                        onClick={() => void loadOperatorGallery({ refresh: true })}
                        variant="secondary"
                      >
                        Refresh
                      </Button>
                    </div>
                  </header>
                  <PrintQueuePanel health={printerHealth} />
                  <RecentGallery
                    busy={recent.busy}
                    error={recent.error}
                    items={recent.items}
                    jobs={jobs}
                    onClose={() => setAdminView('settings')}
                    onRepairCloudPhoto={(sessionId) => void repairCloudPhoto(sessionId)}
                    onRetryJob={(jobId) => void retryJob(jobId)}
                    operator={true}
                    printing={printerHealth !== null}
                    repairingSessionId={repairingSessionId}
                  />
                </section>
              ) : (
                <AdminSettings
                  key={`${adminSettings.activeFrame.id}:${adminSettings.revision}`}
                  busy={adminBusy}
                  error={adminError}
                  health={health}
                  jobs={jobs}
                  onChangePasscode={(currentPasscode, newPasscode) =>
                    void changePasscode(currentPasscode, newPasscode)
                  }
                  onChooseLanCertificate={(passphrase) => void chooseLanCertificate(passphrase)}
                  onConnectCloud={(email, password, supabaseUrl, supabasePublishableKey) =>
                    void connectCloud(email, password, supabaseUrl, supabasePublishableKey)
                  }
                  onOpenCameras={() => setCameraSetupOpen(true)}
                  onOpenFrameEditor={() => setAdminView('frame')}
                  onRefresh={() => void refreshAdminData()}
                  onRetryJob={(jobId: string) => void retryJob(jobId)}
                  onSaveCaptureSettings={(input) => void saveCaptureSettings(input)}
                  onSaveSettings={(input) => void saveSettings(input)}
                  settings={adminSettings}
                  status={adminStatus}
                />
              )}
            </AdminShell>
            <CameraSetupModal
              isOpen={cameraSetupOpen}
              onClose={() => setCameraSetupOpen(false)}
              onCameraSaved={handleCameraSaved}
            />
            {frameImportCandidate ? (
              <FrameImportDialog
                busy={adminBusy}
                candidate={frameImportCandidate}
                onCancel={() => setFrameImportCandidate(null)}
                onConfirm={(name, shotCount) => void confirmAddFrame(name, shotCount)}
              />
            ) : null}
          </>
        </AnchoredToastProvider>
      </ToastProvider>
    );
  }

  const guestDialogTone = dialogToneForScreen(snapshot.screen, loading);

  return (
    <ToastProvider>
      <AnchoredToastProvider>
        <>
          <div
            aria-hidden={dialog || cameraSetupOpen || recent.open ? true : undefined}
            className="guest-layer"
            inert={dialog || cameraSetupOpen || recent.open ? true : undefined}
          >
            {guestContent}
            {!captureWindowOpen ? <PrinterIndicator health={printerHealth} /> : null}
            {cancelArmed ? (
              <div className="cancel-session-hint" data-testid="cancel-hint" role="status">
                Press ESC again to cancel
              </div>
            ) : null}
          </div>
          {dialog ? (
            <PasscodeDialog
              busy={dialogBusy}
              dismissible={dialog.intent !== 'bootstrap'}
              error={dialogError}
              mode={dialog.mode}
              onCancel={() => {
                if (!dialogBusy && dialog.intent !== 'bootstrap') {
                  setDialog(null);
                  setDialogError(null);
                }
              }}
              onClearError={() => setDialogError(null)}
              onSubmit={(passcode) => void submitPasscode(passcode)}
              tone={guestDialogTone}
            />
          ) : null}
          <CameraSetupModal
            isOpen={cameraSetupOpen}
            onClose={() => setCameraSetupOpen(false)}
            onCameraSaved={handleCameraSaved}
          />
          {recent.open && !adminOpen ? (
            <RecentGallery
              busy={recent.busy}
              error={recent.error}
              items={recent.items}
              onClose={closeRecentGallery}
              operator={false}
              printing={printerHealth !== null}
              tone={guestDialogTone}
            />
          ) : null}
        </>
      </AnchoredToastProvider>
    </ToastProvider>
  );
}
