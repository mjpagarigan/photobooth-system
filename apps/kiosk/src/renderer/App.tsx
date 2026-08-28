import {
  SpinnerGapIcon as SpinnerGap,
  ArrowClockwiseIcon as ArrowClockwise,
} from '@phosphor-icons/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type {
  AdminHealth,
  AdminSettings as AdminSettingsData,
  BoothSnapshot,
  CameraResolution,
  FrameLayout,
  GalleryItem,
  GraceBoothBridge,
  RpcResult,
  UploadJobSummary,
} from '@grace-booth/shared';

import { AdminSettings } from './admin/AdminSettings';
import { AdminShell } from './admin/AdminShell';
import { FrameEditor } from './admin/FrameEditor';
import { Button } from './components/Button';
import { CameraSetupModal } from './components/CameraSetupModal';
import { PasscodeDialog } from './components/PasscodeDialog';
import { RecentGallery } from './components/RecentGallery';
import { useCameraStream } from './hooks/useCameraStream';
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

function useCountdown(deadline: number | null, fixedValue?: number): number {
  const computeSeconds = (d: number | null): number =>
    d ? Math.max(1, Math.min(8, Math.ceil((d - Date.now()) / 1_000))) : 8;

  const [seconds, setSeconds] = useState(() => computeSeconds(deadline));
  const [prevDeadline, setPrevDeadline] = useState(deadline);

  if (prevDeadline !== deadline) {
    setPrevDeadline(deadline);
    setSeconds(computeSeconds(deadline));
  }

  useEffect(() => {
    if (fixedValue !== undefined || !deadline) {
      return;
    }

    const update = () => {
      setSeconds(computeSeconds(deadline));
    };
    update();
    const interval = window.setInterval(update, 100);
    return () => {
      window.clearInterval(interval);
    };
  }, [deadline, fixedValue]);

  return fixedValue ?? (deadline ? seconds : 8);
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
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [dialogBusy, setDialogBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [cameraSetupOpen, setCameraSetupOpen] = useState(false);
  const [selectedCameraDeviceId, setSelectedCameraDeviceId] = useState<string | null>(null);
  const [selectedCameraResolution, setSelectedCameraResolution] =
    useState<CameraResolution>('1080p');
  const [cancelArmed, setCancelArmed] = useState(false);
  const [recent, setRecent] = useState<{
    open: boolean;
    busy: boolean;
    items: GalleryItem[];
    error: string | null;
  }>({ open: false, busy: false, items: [], error: null });
  const [visualSeed, setVisualSeed] = useState<VisualSeedPayload | null>(null);
  const countdownAudioRef = useRef<HTMLAudioElement | null>(null);
  const shutterAudioRef = useRef<HTMLAudioElement | null>(null);
  const audioArmedRef = useRef(false);
  const lastCueRef = useRef<number | null>(null);
  const lastStateRef = useRef(snapshot.state);
  const cancelArmedRef = useRef(false);
  const cancelDisarmTimerRef = useRef<number | null>(null);

  const countdownSeconds = useCountdown(
    snapshot.state === 'countdown' ? snapshot.countdownEndsAt : null,
    visualSeed?.countdownSeconds,
  );

  // The webcam stream exists only inside an active capture window (countdown or shutter); it is
  // released as soon as the session leaves those states so no track stays live while idle.
  const captureWindowOpen = snapshot.screen === 'countdown' || snapshot.screen === 'capturing';
  const liveCameraEnabled = !visualSeed && snapshot.cameraPreviewEnabled && captureWindowOpen;
  const camera = useCameraStream(
    liveCameraEnabled,
    selectedCameraDeviceId,
    selectedCameraResolution,
  );
  const grabJpegBase64 = camera.grabJpegBase64;

  useEffect(() => {
    if (!liveCameraEnabled) {
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
  }, [grabJpegBase64, liveCameraEnabled]);

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
          setSelectedCameraDeviceId(cameraConfig.data.deviceId);
          setSelectedCameraResolution(cameraConfig.data.resolution);
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
    if (typeof Audio === 'undefined') {
      return;
    }
    countdownAudioRef.current ??= new Audio(LOCAL_FIXTURES.countdownAudio);
    shutterAudioRef.current ??= new Audio(LOCAL_FIXTURES.shutterAudio);
    countdownAudioRef.current.preload = 'auto';
    shutterAudioRef.current.preload = 'auto';
    countdownAudioRef.current.load();
    shutterAudioRef.current.load();
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
        bridge.admin.listUploadJobs({ limit: 50 }),
      ]);
      const failed = [settingsResult, healthResult, jobsResult].find((result) => !result.ok);
      if (failed) {
        setAdminError(adminErrorMessage(failed));
        return false;
      }
      if (settingsResult.ok && healthResult.ok && jobsResult.ok) {
        setAdminSettings(settingsResult.data);
        setHealth(healthResult.data);
        setJobs(jobsResult.data.items);
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
    (snapshot.state === 'countdown' ||
      snapshot.state === 'capturing' ||
      snapshot.state === 'review');

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
    if (!visualSeed) {
      const bridge = getBridge();
      if (bridge) {
        await bridge.admin.logout().catch(() => undefined);
      }
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
      const result = await bridge.admin.addFrame();
      if (result.ok) {
        if (result.data) {
          await refreshAdminData();
          setAdminStatus('Transparent frame added to the library. Review the slots, then save.');
        }
      } else {
        setAdminError(adminErrorMessage(result));
      }
    } finally {
      setAdminBusy(false);
    }
  }, [refreshAdminData, visualSeed]);

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
    setRecent((current) => ({ open: true, busy: true, items: current.items, error: null }));
    try {
      const result = await bridge.gallery.getRecent(20);
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
      setRecent({
        open: true,
        busy: false,
        items: [],
        error: 'Recent photos could not be loaded.',
      });
    }
  }, [visualSeed]);

  const loadOperatorGallery = useCallback(async () => {
    if (visualSeed) {
      return;
    }
    const bridge = getBridge();
    if (!bridge) {
      setRecent((curr) => ({
        ...curr,
        busy: false,
        items: [],
        error: 'The booth controls are unavailable.',
      }));
      return;
    }
    setRecent((curr) => ({ ...curr, busy: true, error: null }));
    try {
      const result = await bridge.gallery.getRecent(20);
      if (result.ok) {
        setRecent((curr) => ({ ...curr, busy: false, items: result.data, error: null }));
      } else {
        setRecent((curr) => ({
          ...curr,
          busy: false,
          items: [],
          error: safeGuestMessage(result.error.message, 'Recent photos could not be loaded.'),
        }));
      }
    } catch {
      setRecent((curr) => ({
        ...curr,
        busy: false,
        items: [],
        error: 'Recent photos could not be loaded.',
      }));
    }
  }, [visualSeed]);

  const closeRecentGallery = useCallback(() => {
    setRecent((current) => ({ ...current, open: false }));
  }, []);

  // Auto-load the operator gallery when its panel view is opened.
  useEffect(() => {
    if (adminOpen && adminView === 'gallery') {
      void loadOperatorGallery();
    }
  }, [adminOpen, adminView, loadOperatorGallery]);

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
      return (
        <AttractScreen
          busy={guestBusy}
          cameraMessage={guestError}
          canStart={snapshot.controls.canStart}
          onOpenAdmin={() => void beginProtectedAction('admin')}
          onOpenCameras={() => setCameraSetupOpen(true)}
          onOpenRecent={() => void openRecentGallery()}
          onStart={startGuestSession}
        />
      );
    }

    if (snapshot.screen === 'countdown' || snapshot.screen === 'capturing') {
      return (
        <CaptureScreen
          phase={snapshot.screen}
          secondsRemaining={countdownSeconds}
          shotNumber={snapshot.shotNumber ?? Math.min(3, snapshot.captureCount + 1)}
          {...(liveCameraEnabled
            ? { liveVideoRef: camera.videoRef, liveStreamReady: camera.ready }
            : {})}
        />
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
          onAccept={(frameId) =>
            void runGuestCommand((bridge) => bridge.booth.acceptPhotos({ frameId }))
          }
          onRetake={() => void runGuestCommand((bridge) => bridge.booth.retakeAll())}
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
          state={snapshot.state}
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
          collageUrl={snapshot.media.collageUrl}
          onDone={() => void runGuestCommand((bridge) => bridge.booth.done())}
          onOpenRecent={() => void openRecentGallery()}
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
        variant={variant}
      />
    );
  }, [
    beginProtectedAction,
    camera.ready,
    camera.videoRef,
    countdownSeconds,
    guestBusy,
    guestError,
    liveCameraEnabled,
    loading,
    openRecentGallery,
    runGuestCommand,
    startGuestSession,
    snapshot,
  ]);

  if (adminOpen && adminSettings) {
    return (
      <>
        <AdminShell onExit={() => void exitAdmin()} onViewChange={setAdminView} view={adminView}>
          {adminView === 'frame' ? (
            <FrameEditor
              busy={adminBusy}
              error={adminError}
              frames={adminSettings.frames ?? [adminSettings.activeFrame]}
              onAddFrame={() => void addFrame()}
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
                    RECENT PHOTOS
                  </h1>
                  <p>Every finished collage with delivery status and metadata.</p>
                </div>
                <div className="admin-page-header__actions">
                  <Button
                    icon={<ArrowClockwise aria-hidden="true" weight="bold" />}
                    loading={recent.busy}
                    onClick={() => void loadOperatorGallery()}
                    variant="secondary"
                  >
                    Refresh
                  </Button>
                </div>
              </header>
              <RecentGallery
                busy={recent.busy}
                error={recent.error}
                items={recent.items}
                jobs={jobs}
                onClose={() => setAdminView('settings')}
                onRetryJob={(jobId) => void retryJob(jobId)}
                operator={true}
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
              onRefresh={() => void refreshAdminData()}
              onRetryJob={(jobId) => void retryJob(jobId)}
              onSaveSettings={(input) => void saveSettings(input)}
              settings={adminSettings}
              status={adminStatus}
            />
          )}
        </AdminShell>
        <CameraSetupModal
          isOpen={cameraSetupOpen}
          onClose={() => setCameraSetupOpen(false)}
          onCameraSaved={(_adapter, deviceId, resolution) => {
            setSelectedCameraDeviceId(deviceId);
            setSelectedCameraResolution(resolution);
            void refreshAdminData();
          }}
        />
      </>
    );
  }

  return (
    <>
      <div
        aria-hidden={dialog || cameraSetupOpen || recent.open ? true : undefined}
        className="guest-layer"
        inert={dialog || cameraSetupOpen || recent.open ? true : undefined}
      >
        {guestContent}
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
          onSubmit={(passcode) => void submitPasscode(passcode)}
        />
      ) : null}
      <CameraSetupModal
        isOpen={cameraSetupOpen}
        onClose={() => setCameraSetupOpen(false)}
        onCameraSaved={(_adapter, deviceId, resolution) => {
          setSelectedCameraDeviceId(deviceId);
          setSelectedCameraResolution(resolution);
          void refreshAdminData();
        }}
      />
      {recent.open && !adminOpen ? (
        <RecentGallery
          busy={recent.busy}
          error={recent.error}
          items={recent.items}
          onClose={closeRecentGallery}
          operator={false}
        />
      ) : null}
    </>
  );
}
