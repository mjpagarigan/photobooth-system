import {
  ArrowClockwiseIcon as ArrowClockwise,
  ArrowsLeftRightIcon as ArrowsLeftRight,
  ArrowSquareOutIcon as ArrowSquareOut,
  CameraIcon as Camera,
  CheckCircleIcon as CheckCircle,
  CloudIcon as Cloud,
  DatabaseIcon as Database,
  DesktopIcon as Desktop,
  FileLockIcon as FileLock,
  KeyIcon as Key,
  LinkSimpleIcon as LinkSimple,
  LockKeyIcon as LockKey,
  ShieldCheckIcon as ShieldCheck,
  WifiHighIcon as WifiHigh,
  CopyIcon as Copy,
  ImagesIcon as Images,
  PaperPlaneTiltIcon as PaperPlaneTilt,
  TrashIcon as Trash,
} from '@phosphor-icons/react';
import { useEffect, useMemo, useState } from 'react';

import type {
  AdminHealth,
  AdminSettings as AdminSettingsData,
  DisplayInfo,
  DualDisplayMode,
  UploadJobSummary,
} from '@grace-booth/shared';
import {
  Alert,
  Badge,
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  Fieldset,
  FieldsetLegend,
  Form,
  Input,
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
  Switch,
  Tabs,
  TabsList,
  TabsPanel,
  TabsTab,
  Toolbar,
  ToolbarGroup,
} from '@grace-booth/ui';

import { Button } from '../components/Button';

const HEALTH_ICONS = {
  camera: Camera,
  cloud: Cloud,
  database: Database,
  encryption: FileLock,
} as const;

function formatTimestamp(value: number | null): string {
  if (!value) {
    return 'Not scheduled';
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function jobLabel(job: UploadJobSummary): string {
  return job.state.replaceAll('_', ' ');
}

type AdminSettingsProps = {
  busy?: boolean;
  error?: string | null;
  health: AdminHealth | null;
  jobs: UploadJobSummary[];
  onChangePasscode: (currentPasscode: string, newPasscode: string) => void;
  onChooseLanCertificate: (passphrase: string) => void;
  onConnectCloud: (
    email: string,
    password: string,
    supabaseUrl?: string | null,
    supabasePublishableKey?: string | null,
  ) => void;
  onOpenCameras?: () => void;
  onRefresh: () => void;
  onRetryJob?: (jobId: string) => void;
  onSaveSettings: (input: {
    googleFormsUrl: string | null;
    lanEnabled: boolean;
    lanBindHost: string;
    lanPort: number;
    expectedRevision: number;
  }) => void;
  settings: AdminSettingsData;
  status?: string | null;
};

export function AdminSettings({
  busy = false,
  error,
  health,
  jobs,
  onChangePasscode,
  onChooseLanCertificate,
  onConnectCloud,
  onOpenCameras,
  onRefresh,
  onRetryJob,
  onSaveSettings,
  settings,
  status,
}: AdminSettingsProps) {
  const [lanEnabled, setLanEnabled] = useState(settings.lan.enabled);
  const [lanBindHost, setLanBindHost] = useState(settings.lan.bindHost);
  const [lanPort, setLanPort] = useState(String(settings.lan.port));
  const [dualMode, setDualMode] = useState<DualDisplayMode>(settings.dualDisplay.mode);
  const [swapDisplays, setSwapDisplays] = useState(settings.dualDisplay.swapDisplays);
  const [qrDismissSeconds, setQrDismissSeconds] = useState(settings.dualDisplay.qrDismissSeconds);
  const [displays, setDisplays] = useState<DisplayInfo[]>([]);
  const [currentPasscode, setCurrentPasscode] = useState('');
  const [newPasscode, setNewPasscode] = useState('');
  const [confirmPasscode, setConfirmPasscode] = useState('');
  const [googlePhotosEnabled, setGooglePhotosEnabled] = useState(settings.googlePhotos.enabled);
  const [googlePhotosEmail, setGooglePhotosEmail] = useState(
    settings.googlePhotos.connectedEmail ?? '',
  );
  const [googlePhotosShareUrl, setGooglePhotosShareUrl] = useState(
    settings.googlePhotos.albumShareUrl ?? '',
  );
  const [googlePhotosAlbumTitle, setGooglePhotosAlbumTitle] = useState(
    settings.googlePhotos.albumTitle ?? '',
  );
  const [googlePhotosAlbumId, setGooglePhotosAlbumId] = useState(
    settings.googlePhotos.albumId ?? '',
  );
  const [newAlbumTitle, setNewAlbumTitle] = useState('');
  const [availableAlbums, setAvailableAlbums] = useState<
    { id: string; title: string; shareUrl?: string | undefined }[]
  >([]);
  const [hasRefreshToken, setHasRefreshToken] = useState(true);
  const [hasCredentials, setHasCredentials] = useState(true);
  const [googleStats, setGoogleStats] = useState({
    syncedCount: 0,
    pendingCount: 0,
    failedCount: 0,
  });
  const [copiedLink, setCopiedLink] = useState(false);
  const [googleFeedback, setGoogleFeedback] = useState<string | null>(null);

  const fetchGoogleStatus = async () => {
    const bridge = window.graceBooth;
    if (!bridge?.admin.getGooglePhotosStatus) return;
    try {
      const res = await bridge.admin.getGooglePhotosStatus();
      if (res.ok) {
        setGooglePhotosEnabled(res.data.config.enabled);
        setGooglePhotosEmail(res.data.config.connectedEmail ?? '');
        setGooglePhotosShareUrl(res.data.config.albumShareUrl ?? '');
        setGooglePhotosAlbumTitle(res.data.config.albumTitle ?? '');
        setGooglePhotosAlbumId(res.data.config.albumId ?? '');
        setGoogleStats(res.data.stats);
        setHasRefreshToken(res.data.hasRefreshToken);
        setHasCredentials(res.data.hasCredentials);
      }
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    let mounted = true;
    const fetchStatus = async () => {
      const bridge = window.graceBooth;
      if (!bridge?.admin.getGooglePhotosStatus) return;
      try {
        const res = await bridge.admin.getGooglePhotosStatus();
        if (res.ok && mounted) {
          setGooglePhotosEnabled(res.data.config.enabled);
          setGooglePhotosEmail(res.data.config.connectedEmail ?? '');
          setGooglePhotosShareUrl(res.data.config.albumShareUrl ?? '');
          setGooglePhotosAlbumTitle(res.data.config.albumTitle ?? '');
          setGooglePhotosAlbumId(res.data.config.albumId ?? '');
          setGoogleStats(res.data.stats);
          setHasRefreshToken(res.data.hasRefreshToken);
          setHasCredentials(res.data.hasCredentials);
        }
      } catch {
        // ignore
      }
    };
    void fetchStatus();
    const interval = setInterval(() => {
      void fetchStatus();
    }, 3000);
    const onFocus = () => void fetchStatus();
    window.addEventListener('focus', onFocus);
    return () => {
      mounted = false;
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  const handleResolveAlbum = async () => {
    const bridge = window.graceBooth;
    if (!bridge?.admin.resolveGooglePhotosAlbum || !googlePhotosShareUrl.trim()) return;
    setGoogleFeedback('Resolving album...');
    try {
      const res = await bridge.admin.resolveGooglePhotosAlbum(googlePhotosShareUrl.trim());
      if (res.ok) {
        setGooglePhotosAlbumTitle(res.data.albumTitle);
        setGooglePhotosAlbumId(res.data.albumId);
        setGoogleFeedback(`Resolved: ${res.data.albumTitle}`);
      } else {
        setGoogleFeedback(`Could not resolve album: ${res.error.message}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error resolving album link.';
      setGoogleFeedback(msg);
    }
  };

  const handleCreateAlbum = async () => {
    const bridge = window.graceBooth;
    const title = newAlbumTitle.trim() || 'M.A.T. Photobooth';
    if (!bridge?.admin.createGooglePhotosAlbum) return;
    setGoogleFeedback(`Creating shared album "${title}" in Google Photos...`);
    try {
      const res = await bridge.admin.createGooglePhotosAlbum(title);
      if (res.ok) {
        setGooglePhotosAlbumTitle(res.data.albumTitle);
        setGooglePhotosAlbumId(res.data.albumId);
        setGooglePhotosShareUrl(res.data.shareUrl);
        setGooglePhotosEnabled(true);
        setNewAlbumTitle('');
        setGoogleFeedback(`Shared album "${res.data.albumTitle}" created and active!`);
        await bridge.admin.saveGooglePhotosConfig({
          enabled: true,
          connectedEmail: googlePhotosEmail.trim() || null,
          albumId: res.data.albumId,
          albumTitle: res.data.albumTitle,
          albumShareUrl: res.data.shareUrl,
        });
        onRefresh();
      } else {
        setGoogleFeedback(`Failed to create album: ${res.error.message}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to create album in Google Photos.';
      setGoogleFeedback(msg);
    }
  };

  const handleLoadAlbums = async () => {
    const bridge = window.graceBooth;
    if (!bridge?.admin.listGooglePhotosAlbums) return;
    setGoogleFeedback('Fetching albums from Google Photos...');
    try {
      const res = await bridge.admin.listGooglePhotosAlbums();
      if (res.ok) {
        setAvailableAlbums(res.data);
        if (res.data.length === 0) {
          setGoogleFeedback('No albums found in your Google Photos library. Use "Create & Select" above to make one.');
        } else {
          setGoogleFeedback(`Loaded ${res.data.length} album(s) from Google Photos.`);
        }
      } else {
        setGoogleFeedback(`Failed to fetch albums: ${res.error.message}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch albums from Google Photos.';
      setGoogleFeedback(msg);
    }
  };

  const handleSyncNow = async () => {
    const bridge = window.graceBooth;
    if (!bridge?.admin.syncGooglePhotosNow) return;
    setGoogleFeedback('Syncing queued photos to Google Photos...');
    try {
      const res = await bridge.admin.syncGooglePhotosNow();
      if (res.ok) {
        setGoogleFeedback(`Sync complete: ${res.data.succeeded} uploaded, ${res.data.failed} failed (${res.data.processed} processed).`);
        onRefresh();
      } else {
        setGoogleFeedback(`Sync operation failed: ${res.error.message}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to execute sync.';
      setGoogleFeedback(msg);
    }
  };

  const handleSaveGooglePhotos = async (event?: React.SyntheticEvent) => {
    event?.preventDefault();
    const bridge = window.graceBooth;
    if (!bridge?.admin.saveGooglePhotosConfig) return;
    setGoogleFeedback('Saving configuration...');
    try {
      const res = await bridge.admin.saveGooglePhotosConfig({
        enabled: googlePhotosEnabled,
        connectedEmail: googlePhotosEmail.trim() || null,
        albumId: googlePhotosAlbumId.trim() || null,
        albumTitle: googlePhotosAlbumTitle.trim() || null,
        albumShareUrl: googlePhotosShareUrl.trim() || null,
      });
      if (res.ok) {
        setGoogleFeedback('Google Photos configuration saved.');
        onRefresh();
      } else {
        setGoogleFeedback('Failed to save configuration.');
      }
    } catch {
      setGoogleFeedback('Failed to save Google Photos configuration.');
    }
  };

  const handleConnectGoogleOAuth = () => {
    const baseUrl = supabaseUrl ? supabaseUrl.replace(/\/$/, '') : 'https://bejgkclvsfbkpkflftxu.supabase.co';
    const authUrl = `${baseUrl}/functions/v1/google-photos-auth`;

    const bridge = window.graceBooth;
    if (bridge?.admin.openExternalUrl) {
      void bridge.admin.openExternalUrl(authUrl);
    } else {
      window.open(authUrl, '_blank');
    }
  };

  const handleCopyAlbumLink = () => {
    if (!googlePhotosShareUrl) return;
    void navigator.clipboard.writeText(googlePhotosShareUrl);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2500);
  };

  const handleOpenAlbumInBrowser = () => {
    if (!googlePhotosShareUrl) return;
    const bridge = window.graceBooth;
    if (bridge?.admin.openExternalUrl) {
      void bridge.admin.openExternalUrl(googlePhotosShareUrl);
    } else {
      window.open(googlePhotosShareUrl, '_blank');
    }
  };

  const handleTestGoogleUpload = async () => {
    const bridge = window.graceBooth;
    if (!bridge?.admin.testGooglePhotosUpload) return;
    setGoogleFeedback('Sending test photo to Google Photos...');
    try {
      const res = await bridge.admin.testGooglePhotosUpload();
      if (res.ok) {
        setGoogleFeedback(res.data.message);
      } else {
        setGoogleFeedback(`Test photo failed: ${res.error.message}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Test photo failed.';
      setGoogleFeedback(msg);
    }
  };

  const handleDisconnectGoogle = async () => {
    const bridge = window.graceBooth;
    if (!bridge?.admin.disconnectGooglePhotos) return;
    try {
      await bridge.admin.disconnectGooglePhotos();
      setGooglePhotosEnabled(false);
      setGooglePhotosEmail('');
      setGooglePhotosAlbumId('');
      setGooglePhotosAlbumTitle('');
      setGooglePhotosShareUrl('');
      setGoogleFeedback('Google Photos disconnected.');
      onRefresh();
    } catch {
      setGoogleFeedback('Failed to disconnect Google Photos.');
    }
  };

  useEffect(() => {
    const bridge = window.graceBooth;
    if (bridge?.admin.getDisplays) {
      void bridge.admin.getDisplays().then((res) => {
        if (res.ok) setDisplays(res.data);
      });
    }
  }, []);

  const handleSwap = async () => {
    const bridge = window.graceBooth;
    if (!bridge?.admin.swapDisplays) return;
    setLocalError(null);
    try {
      const res = await bridge.admin.swapDisplays();
      if (res.ok) {
        setDisplays(res.data);
        setSwapDisplays((prev) => !prev);
      }
    } catch {
      setLocalError('Displays could not be swapped.');
    }
  };

  const handleSaveDualDisplay = async (event?: React.SyntheticEvent) => {
    event?.preventDefault();
    const bridge = window.graceBooth;
    if (!bridge?.admin.saveDualDisplaySettings) return;
    setLocalError(null);
    try {
      const res = await bridge.admin.saveDualDisplaySettings({
        mode: dualMode,
        swapDisplays,
        qrDismissSeconds,
      });
      if (res.ok) {
        onRefresh();
      }
    } catch {
      setLocalError('Dual display settings could not be saved.');
    }
  };
  const [supabaseUrl, setSupabaseUrl] = useState(settings.supabaseUrl ?? '');
  const [supabasePublishableKey, setSupabasePublishableKey] = useState(
    settings.supabasePublishableKey ?? '',
  );
  const [email, setEmail] = useState('');
  const [cloudPassword, setCloudPassword] = useState('');
  const [certificatePassphrase, setCertificatePassphrase] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  const failedJobs = useMemo(() => jobs.filter((job) => job.state === 'failed'), [jobs]);

  const saveSettings = (event?: React.SyntheticEvent) => {
    event?.preventDefault();
    setLocalError(null);
    const parsedPort = Number(lanPort);
    if (!Number.isInteger(parsedPort) || parsedPort < 1024 || parsedPort > 65535) {
      setLocalError('LAN port must be between 1024 and 65535.');
      return;
    }
    onSaveSettings({
      googleFormsUrl: settings.googleFormsUrl,
      lanEnabled,
      lanBindHost,
      lanPort: parsedPort,
      expectedRevision: settings.revision,
    });
  };

  const changePasscode = (event?: React.SyntheticEvent) => {
    event?.preventDefault();
    setLocalError(null);
    if (currentPasscode.length < 8 || newPasscode.length < 8) {
      setLocalError('Both passcodes must contain at least 8 characters.');
      return;
    }
    if (newPasscode !== confirmPasscode) {
      setLocalError('New passcodes do not match.');
      return;
    }
    onChangePasscode(currentPasscode, newPasscode);
    setCurrentPasscode('');
    setNewPasscode('');
    setConfirmPasscode('');
  };

  const connectCloud = (event?: React.SyntheticEvent) => {
    event?.preventDefault();
    setLocalError(null);
    const trimmedEmail = email.trim();
    if (!trimmedEmail || !cloudPassword) {
      setLocalError('Enter the dedicated booth email and password.');
      return;
    }
    let formattedUrl = supabaseUrl.trim();
    if (
      formattedUrl &&
      !formattedUrl.startsWith('http://') &&
      !formattedUrl.startsWith('https://')
    ) {
      formattedUrl = `https://${formattedUrl}`;
    }
    onConnectCloud(
      trimmedEmail,
      cloudPassword,
      formattedUrl || null,
      supabasePublishableKey.trim() || null,
    );
    setCloudPassword('');
  };

  const chooseCertificate = () => {
    setLocalError(null);
    if (!certificatePassphrase) {
      setLocalError('Enter the certificate passphrase before selecting the protected file.');
      return;
    }
    onChooseLanCertificate(certificatePassphrase);
    setCertificatePassphrase('');
  };

  return (
    <div className="admin-settings" data-testid="admin-settings">
      <header className="admin-page-header admin-page-header--settings">
        <div>
          <h1 data-screen-heading tabIndex={-1}>
            SETTINGS &amp; TELEMETRY
          </h1>
          <p>Hardware diagnostics, network interfaces, cloud persistence, and access tokens.</p>
        </div>
        <Toolbar aria-label="Settings actions">
          <ToolbarGroup>
            <Button
              icon={<ArrowClockwise aria-hidden="true" weight="bold" />}
              disabled={busy}
              onClick={onRefresh}
              variant="secondary"
            >
              Refresh status
            </Button>
          </ToolbarGroup>
        </Toolbar>
      </header>
      <div className="settings-scroll">
        {status ? (
          <Alert className="settings-banner settings-banner--success" role="status">
            {status}
          </Alert>
        ) : null}
        {(localError ?? error) ? (
          <Alert className="settings-banner settings-banner--error" role="alert">
            {localError ?? error}
          </Alert>
        ) : null}

        <Tabs className="settings-tabs" defaultValue="overview">
          <TabsList
            activateOnFocus
            aria-label="Settings categories"
            className="settings-tabs__list"
            variant="underline"
          >
            <TabsTab value="overview">Overview</TabsTab>
            <TabsTab value="network">Network</TabsTab>
            <TabsTab value="displays">Displays</TabsTab>
            <TabsTab value="google">Google Photos</TabsTab>
            <TabsTab value="security">Security &amp; Cloud</TabsTab>
            <TabsTab value="queue">Upload Queue</TabsTab>
          </TabsList>

        <TabsPanel className="settings-tabs__panel" value="overview">

        <section className="settings-section" aria-labelledby="health-title">
          <div className="settings-section__heading">
            <h2 id="health-title">SYSTEM HEALTH &amp; SUBSYSTEMS</h2>
            <p>
              Live diagnostics across optical hardware, database, encrypted storage, and cloud
              gateway.
            </p>
          </div>
          <div className="health-grid">
            {(Object.keys(HEALTH_ICONS) as (keyof typeof HEALTH_ICONS)[]).map((key) => {
              const Icon = HEALTH_ICONS[key];
              const service = health?.[key];
              const state = service?.state ?? 'unavailable';
              return (
                <article className="health-card" key={key}>
                  <Icon aria-hidden="true" weight="bold" />
                  <div>
                    <strong>{key.toUpperCase()}</strong>
                    <span className={`health-state health-state--${state}`}>
                      {state.toUpperCase()}
                    </span>
                  </div>
                  <p>{service?.message ?? 'Subsystem telemetry offline.'}</p>
                </article>
              );
            })}
          </div>
        </section>

        <section className="settings-section" aria-labelledby="camera-settings-title">
          <div className="settings-section__heading">
            <h2 id="camera-settings-title">OPTICAL CAPTURE HARDWARE</h2>
            <p>Active optical device configuration and diagnostic test pattern feed.</p>
          </div>
          <div className="settings-card camera-settings-card">
            <div className="camera-settings-card__info">
              <div>
                <strong>Active Source: </strong>
                <span className="camera-adapter-tag">
                  {settings.cameraAdapter === 'sony'
                    ? 'Sony A7 Mirrorless'
                    : settings.cameraAdapter === 'mock'
                      ? 'Mock Camera'
                      : 'Laptop / Internal Webcam'}
                </span>
              </div>
              {settings.cameraDeviceId && (
                <div className="camera-device-id-text">
                  <small>Device ID: {settings.cameraDeviceId}</small>
                </div>
              )}
              <div className="camera-device-id-text">
                <small>Resolution: {settings.cameraResolution}</small>
              </div>
            </div>
            {onOpenCameras && (
              <Button
                icon={<Camera aria-hidden="true" weight="bold" />}
                onClick={onOpenCameras}
                variant="secondary"
              >
                Configure Camera &amp; Test Feed
              </Button>
            )}
          </div>
        </section>

          <article className="settings-card retention-card">
            <div className="settings-card__title">
              <FileLock aria-hidden="true" weight="bold" />
              <div><h2>Retention</h2><p>Locked privacy windows for every guest photo.</p></div>
            </div>
            <div className="retention-values">
              <div><strong>{settings.cloudRetentionDays}</strong><span>days in cloud storage</span></div>
              <div><strong>{settings.localRetentionDays}</strong><span>days on this booth</span></div>
            </div>
            <p><LockKey aria-hidden="true" weight="bold" /> Retention periods cannot be changed from the booth.</p>
          </article>
        </TabsPanel>

        <TabsPanel className="settings-tabs__panel" value="network">
          <Form className="settings-card settings-form" noValidate onSubmit={saveSettings}>
            <div className="settings-card__title">
              <LinkSimple aria-hidden="true" weight="bold" />
              <div>
                <h2>Network &amp; delivery</h2>
                <p>Configure local network access for kiosk operations.</p>
              </div>
            </div>
            <Fieldset className="lan-fieldset">
              <FieldsetLegend>Trusted network access</FieldsetLegend>
              <label className="switch-row">
                <span>
                  <strong>Allow LAN admin access</strong>
                  <small>Off by default. Enable only on a trusted private network.</small>
                </span>
                <Switch
                  checked={lanEnabled}
                  onCheckedChange={setLanEnabled}
                />
              </label>
              <div className="two-field-grid">
                <Field name="lan-bind-host">
                  <FieldLabel>Bind address</FieldLabel>
                  <Input
                    disabled={!lanEnabled}
                    onChange={(event) => setLanBindHost(event.target.value)}
                    type="text"
                    value={lanBindHost}
                  />
                </Field>
                <Field invalid={Boolean(localError?.includes('port'))} name="lan-port">
                  <FieldLabel>Port</FieldLabel>
                  <Input
                    disabled={!lanEnabled}
                    onChange={(event) => setLanPort(event.target.value)}
                    type="number"
                    value={lanPort}
                  />
                  <FieldError>{localError?.includes('port') ? localError : null}</FieldError>
                </Field>
              </div>
              <p className="certificate-state">
                <ShieldCheck aria-hidden="true" weight="bold" />
                {settings.lan.tlsConfigured
                  ? 'TLS certificate configured'
                  : 'TLS certificate required before LAN access'}
              </p>
              <Field name="certificate-passphrase">
                <FieldLabel>Certificate passphrase</FieldLabel>
                <div className="certificate-actions">
                <Input
                  autoComplete="new-password"
                  onChange={(event) => setCertificatePassphrase(event.target.value)}
                  placeholder="Used once to import the certificate"
                  type="password"
                  value={certificatePassphrase}
                />
                <Button
                  disabled={busy}
                  icon={<FileLock aria-hidden="true" weight="bold" />}
                  onClick={chooseCertificate}
                  variant="secondary"
                >
                  Choose certificate
                </Button>
                </div>
                <FieldDescription>Used once to import the protected certificate.</FieldDescription>
              </Field>
            </Fieldset>
            <Button
              icon={<CheckCircle aria-hidden="true" weight="bold" />}
              loading={busy}
              type="submit"
            >
              Save settings
            </Button>
          </Form>
        </TabsPanel>

        <TabsPanel className="settings-tabs__panel" value="displays">
          <Form className="settings-card settings-form" onSubmit={handleSaveDualDisplay}>
            <div className="settings-card__title">
              <Desktop aria-hidden="true" weight="bold" />
              <div>
                <h2>Dual-Monitor Setup</h2>
                <p>
                  Configure Screen 1 (Capture) and Screen 2 (QR Delivery) monitors ({displays.length}{' '}
                  detected).
                </p>
              </div>
            </div>
            <Field name="dual-mode">
            <FieldLabel>Dual display mode</FieldLabel>
            <Select
              items={[{label:'Auto (Enabled when 2 monitors connected)',value:'auto'},{label:'Force Enabled',value:'enabled'},{label:'Disabled (Single Monitor Only)',value:'disabled'}]}
              value={dualMode}
              onValueChange={(value) => value !== null && setDualMode(value)}
            >
              <SelectTrigger aria-label="Dual display mode"><SelectValue /></SelectTrigger>
              <SelectPopup>{(['auto','enabled','disabled'] as const).map((value) => <SelectItem key={value} value={value}>{value === 'auto' ? 'Auto (Enabled when 2 monitors connected)' : value === 'enabled' ? 'Force Enabled' : 'Disabled (Single Monitor Only)'}</SelectItem>)}</SelectPopup>
            </Select>
            </Field>
            <Field name="qr-timeout">
            <FieldLabel>QR auto-dismiss duration</FieldLabel>
            <Select
              items={[30,45,60,90].map((value) => ({ label: `${value} seconds`, value }))}
              value={qrDismissSeconds}
              onValueChange={(value) => value !== null && setQrDismissSeconds(value)}
            >
              <SelectTrigger aria-label="QR auto-dismiss duration"><SelectValue /></SelectTrigger>
              <SelectPopup>{[30,45,60,90].map((value) => <SelectItem key={value} value={value}>{value} seconds{value === 45 ? ' (Default)' : ''}</SelectItem>)}</SelectPopup>
            </Select>
            </Field>
            <div className="two-field-grid">
              <Button
                icon={<ArrowsLeftRight aria-hidden="true" weight="bold" />}
                loading={busy}
                onClick={handleSwap}
                type="button"
                variant="secondary"
              >
                Swap Displays
              </Button>
              <Button
                icon={<CheckCircle aria-hidden="true" weight="bold" />}
                loading={busy}
                type="submit"
              >
                Save Display
              </Button>
            </div>
          </Form>
        </TabsPanel>

        <TabsPanel className="settings-tabs__panel" value="google">
          <Form className="settings-card settings-form" onSubmit={handleSaveGooglePhotos}>
            <div className="settings-card__title">
              <Images aria-hidden="true" weight="bold" />
              <div>
                <h2>Google Photos Shared Album Sync</h2>
                <p>Live stream completed photo strips into an active Google Photos shared album.</p>
              </div>
            </div>

            <Field className="form-toggle" name="google-photos-enabled">
              <label className="switch-row">
                <span><strong>Enable Google Photos live sync</strong><small>Send completed strips to the configured shared album.</small></span>
                <Switch
                  checked={googlePhotosEnabled}
                  onCheckedChange={setGooglePhotosEnabled}
                />
              </label>
            </Field>

            <label>Google Account Authorization</label>
            <div className="two-field-grid">
              {googlePhotosEmail ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'rgba(34, 197, 94, 0.1)', border: '1px solid rgba(34, 197, 94, 0.3)', borderRadius: '6px', padding: '0.5rem 0.75rem', color: '#4ade80' }}>
                  <CheckCircle aria-hidden="true" weight="bold" />
                  <span style={{ fontSize: '0.875rem', fontWeight: 600 }}>{googlePhotosEmail}</span>
                </div>
              ) : (
                <Button
                  icon={<Cloud aria-hidden="true" weight="bold" />}
                  onClick={handleConnectGoogleOAuth}
                  type="button"
                  variant="secondary"
                >
                  Authorize Google Account
                </Button>
              )}
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                {googlePhotosEmail ? (
                  <>
                    <Button
                      icon={<Trash aria-hidden="true" weight="bold" />}
                      onClick={handleDisconnectGoogle}
                      type="button"
                      variant="secondary"
                    >
                      Disconnect
                    </Button>
                    {!hasRefreshToken ? (
                      <Button
                        icon={<Cloud aria-hidden="true" weight="bold" />}
                        onClick={handleConnectGoogleOAuth}
                        type="button"
                      >
                        Re-authorize
                      </Button>
                    ) : null}
                  </>
                ) : null}
                <Button
                  icon={<ArrowClockwise aria-hidden="true" weight="bold" />}
                  onClick={fetchGoogleStatus}
                  type="button"
                  variant="secondary"
                >
                  Check Auth Status
                </Button>
              </div>
            </div>

            {!hasCredentials ? (
              <Alert variant="error" style={{ marginTop: '0.5rem' }}>
                Google OAuth secrets are missing in Supabase Edge Functions. Please set <code>GOOGLE_CLIENT_ID</code> and <code>GOOGLE_CLIENT_SECRET</code> in Supabase Secrets.
              </Alert>
            ) : null}

            {googlePhotosEmail && !hasRefreshToken ? (
              <Alert variant="error" style={{ marginTop: '0.5rem' }}>
                Offline background sync permissions are missing. Please click <strong>Re-authorize</strong> and make sure to grant all Photos permissions.
              </Alert>
            ) : null}

            <Field name="create-new-album">
              <FieldLabel>Create new shared event album (Recommended)</FieldLabel>
              <div className="two-field-grid">
                <Input
                  type="text"
                  placeholder="e.g. Ministry Fair 2026"
                  value={newAlbumTitle}
                  onChange={(e) => setNewAlbumTitle(e.target.value)}
                />
                <Button
                  icon={<Images aria-hidden="true" weight="bold" />}
                  onClick={handleCreateAlbum}
                  type="button"
                >
                  Create &amp; Select
                </Button>
              </div>
              <FieldDescription>
                Creates a dedicated shared album on Google Photos and sets it as the live sync target.
              </FieldDescription>
            </Field>

            <Alert variant="info" style={{ marginTop: '0.25rem', fontSize: '0.85rem' }}>
              <strong>Google Photos Integration Policy:</strong> Google Photos API requires the shared album to be created through the Photobooth so that captured photos can be automatically streamed into it during the event.
            </Alert>

            <Field name="google-album-url">
              <FieldLabel>Or link existing photobooth-created shared album URL / ID</FieldLabel>
              <div className="two-field-grid">
                <Input
                  type="text"
                  placeholder="https://photos.app.goo.gl/..."
                  value={googlePhotosShareUrl}
                  onChange={(e) => setGooglePhotosShareUrl(e.target.value)}
                />
                <Button
                  icon={<LinkSimple aria-hidden="true" weight="bold" />}
                  onClick={handleResolveAlbum}
                  type="button"
                  variant="secondary"
                >
                  Resolve Link
                </Button>
              </div>
            </Field>

            {availableAlbums.length > 0 ? (
              <Field name="select-existing-album">
                <FieldLabel>Pick from your Google Photos albums</FieldLabel>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '140px', overflowY: 'auto', background: 'rgba(0,0,0,0.2)', padding: '0.5rem', borderRadius: '6px' }}>
                  {availableAlbums.map((alb) => (
                    <button
                      key={alb.id}
                      type="button"
                      onClick={() => {
                        setGooglePhotosAlbumId(alb.id);
                        setGooglePhotosAlbumTitle(alb.title);
                        if (alb.shareUrl) setGooglePhotosShareUrl(alb.shareUrl);
                        setGoogleFeedback(`Selected album: ${alb.title}`);
                      }}
                      style={{
                        textAlign: 'left',
                        padding: '0.4rem 0.6rem',
                        background: googlePhotosAlbumId === alb.id ? 'rgba(163, 94, 71, 0.25)' : 'transparent',
                        border: googlePhotosAlbumId === alb.id ? '1px solid #A35E47' : '1px solid rgba(255,255,255,0.08)',
                        borderRadius: '4px',
                        color: '#fff',
                        cursor: 'pointer',
                        fontSize: '0.85rem',
                      }}
                    >
                      <strong>{alb.title}</strong> {alb.shareUrl ? <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>({alb.shareUrl})</span> : null}
                    </button>
                  ))}
                </div>
              </Field>
            ) : (
              <div style={{ marginTop: '0.25rem' }}>
                <Button
                  icon={<ArrowClockwise aria-hidden="true" weight="bold" />}
                  onClick={handleLoadAlbums}
                  type="button"
                  variant="secondary"
                >
                  Browse My Google Albums
                </Button>
              </div>
            )}

            {googlePhotosAlbumTitle ? (
              <div className="info-banner" style={{ marginTop: '0.75rem' }}>
                <CheckCircle aria-hidden="true" weight="bold" />
                <span>Active Target Album: <strong>{googlePhotosAlbumTitle}</strong></span>
              </div>
            ) : null}

            <div className="operator-share-hub" style={{ marginTop: '1rem', padding: '0.75rem', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <span style={{ fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>
                  Sync Operations &amp; Verification
                </span>
              </div>
              <div className="two-field-grid">
                {googlePhotosShareUrl ? (
                  <>
                    <Button
                      icon={<Copy aria-hidden="true" weight="bold" />}
                      onClick={handleCopyAlbumLink}
                      type="button"
                      variant="secondary"
                    >
                      {copiedLink ? 'Copied to Clipboard!' : 'Copy Guest Album Link'}
                    </Button>
                    <Button
                      icon={<ArrowSquareOut aria-hidden="true" weight="bold" />}
                      onClick={handleOpenAlbumInBrowser}
                      type="button"
                      variant="secondary"
                    >
                      Open in Browser
                    </Button>
                  </>
                ) : null}
                <Button
                  icon={<PaperPlaneTilt aria-hidden="true" weight="bold" />}
                  onClick={handleTestGoogleUpload}
                  type="button"
                  variant="secondary"
                >
                  Send Test Photo
                </Button>
                <Button
                  icon={<ArrowClockwise aria-hidden="true" weight="bold" />}
                  onClick={handleSyncNow}
                  type="button"
                  variant="secondary"
                >
                  Sync Pending Now
                </Button>
              </div>
            </div>

            <div className="retention-values" style={{ marginTop: '1rem' }}>
              <div>
                <strong>{googleStats.syncedCount}</strong>
                <span>Synced Strips</span>
              </div>
              <div>
                <strong>{googleStats.pendingCount}</strong>
                <span>Pending</span>
              </div>
              <div>
                <strong>{googleStats.failedCount}</strong>
                <span>Failed</span>
              </div>
            </div>

            {googleFeedback ? (
              <p style={{ fontSize: '0.9rem', color: 'var(--accent-color, #70b8ff)', margin: '0.5rem 0' }}>
                {googleFeedback}
              </p>
            ) : null}

            <Button
              icon={<CheckCircle aria-hidden="true" weight="bold" />}
              loading={busy}
              type="submit"
            >
              Save Google Photos Config
            </Button>
          </Form>
        </TabsPanel>

        <TabsPanel className="settings-tabs__panel" value="queue">
        <section className="settings-section" aria-labelledby="queue-title">
          <div className="settings-section__heading settings-section__heading--inline">
            <div>
              <h2 id="queue-title">UPLOAD QUEUE &amp; RETRY BUFFER</h2>
              <p>
                {failedJobs.length === 0
                  ? 'No failed uploads need attention.'
                  : `${failedJobs.length} failed upload${failedJobs.length === 1 ? '' : 's'} need attention.`}
              </p>
            </div>
            <span className="telemetry-counter">{jobs.length} RECENT JOBS</span>
          </div>
          <div className="upload-list">
            {jobs.length === 0 ? (
              <div className="empty-queue">
                <Cloud aria-hidden="true" weight="bold" />
                <strong>QUEUE IS CLEAR</strong>
                <span>New completed collages will appear here while they upload.</span>
              </div>
            ) : (
              jobs.map((job) => (
                <article className="upload-job" key={job.id}>
                  <div className="upload-job__state">
                    <Cloud aria-hidden="true" weight="bold" />
                    <div>
                      <strong>{jobLabel(job).toUpperCase()}</strong>
                      <span>Attempt {job.attemptCount}</span>
                    </div>
                  </div>
                  <div className="upload-job__timing">
                    <span>Updated {formatTimestamp(job.updatedAt)}</span>
                    {job.nextAttemptAt ? (
                      <small>Next try {formatTimestamp(job.nextAttemptAt)}</small>
                    ) : null}
                  </div>
                  {job.state === 'failed' ? (
                    <Button
                      icon={<ArrowClockwise aria-hidden="true" weight="bold" />}
                      loading={busy}
                      onClick={() => onRetryJob?.(job.id)}
                      variant="secondary"
                    >
                      Retry upload
                    </Button>
                  ) : (
                    <Badge className={`job-state job-state--${job.state}`}>{jobLabel(job)}</Badge>
                  )}
                </article>
              ))
            )}
          </div>
        </section>
        </TabsPanel>

        <TabsPanel className="settings-tabs__panel" value="security">
        <section
          className="settings-section settings-section--split"
          aria-label="Secure booth access"
        >
          <Form className="settings-card settings-form" noValidate onSubmit={changePasscode}>
            <div className="settings-card__title">
              <Key aria-hidden="true" weight="bold" />
              <div>
                <h2>Change passcode</h2>
                <p>Use at least 8 characters for the shared operator passcode.</p>
              </div>
            </div>
            <Field name="current-passcode"><FieldLabel>Current passcode</FieldLabel><Input
              autoComplete="current-password"
              maxLength={64}
              minLength={8}
              onChange={(event) => setCurrentPasscode(event.target.value)}
              type="password"
              value={currentPasscode}
            /></Field>
            <div className="two-field-grid">
              <Field name="new-passcode"><FieldLabel>New passcode</FieldLabel><Input
                  autoComplete="new-password"
                  maxLength={64}
                  minLength={8}
                  onChange={(event) => setNewPasscode(event.target.value)}
                  type="password"
                  value={newPasscode}
                /></Field>
              <Field name="confirm-passcode"><FieldLabel>Confirm passcode</FieldLabel><Input
                  autoComplete="new-password"
                  maxLength={64}
                  minLength={8}
                  onChange={(event) => setConfirmPasscode(event.target.value)}
                  type="password"
                  value={confirmPasscode}
                /></Field>
            </div>
            <Button
              icon={<LockKey aria-hidden="true" weight="bold" />}
              loading={busy}
              type="submit"
            >
              Change passcode
            </Button>
          </Form>

          <Form className="settings-card settings-form" noValidate onSubmit={connectCloud}>
            <div className="settings-card__title">
              <WifiHigh aria-hidden="true" weight="bold" />
              <div>
                <h2>Cloud connection</h2>
                <p>Connect the dedicated booth account. Credentials are never displayed again.</p>
              </div>
            </div>
            <Field name="supabase-url"><FieldLabel>Supabase project URL</FieldLabel><Input
              onChange={(event) => setSupabaseUrl(event.target.value)}
              placeholder="https://<project-ref>.supabase.co"
              type="url"
              value={supabaseUrl}
            /></Field>
            <Field name="supabase-key"><FieldLabel>Supabase publishable / anon key</FieldLabel><Input
              onChange={(event) => setSupabasePublishableKey(event.target.value)}
              placeholder="sb_publishable_... or anon key"
              type="text"
              value={supabasePublishableKey}
            /></Field>
            <Field name="booth-email"><FieldLabel>Booth account email</FieldLabel><Input
              autoComplete="username"
              onChange={(event) => setEmail(event.target.value)}
              placeholder="booth@example.com"
              type="email"
              value={email}
            /></Field>
            <Field name="booth-cloud-password"><FieldLabel>Booth account password</FieldLabel><Input
              autoComplete="current-password"
              onChange={(event) => setCloudPassword(event.target.value)}
              type="password"
              value={cloudPassword}
            /></Field>
            <Button
              icon={<ShieldCheck aria-hidden="true" weight="bold" />}
              loading={busy}
              type="submit"
            >
              Connect cloud
            </Button>
          </Form>
        </section>
        </TabsPanel>
        </Tabs>
      </div>
    </div>
  );
}
