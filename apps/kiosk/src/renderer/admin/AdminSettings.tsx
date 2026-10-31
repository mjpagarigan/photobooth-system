import {
  ArrowClockwise,
  ArrowsLeftRight,
  ArrowSquareOut,
  Camera,
  CheckCircle,
  Cloud,
  Copy,
  Database,
  Desktop,
  FileLock,
  Images,
  Key,
  LinkSimple,
  LockKey,
  PaperPlaneTilt,
  ShieldCheck,
  Trash,
  WifiHigh,
} from '@grace-booth/ui';
import { useEffect, useMemo, useRef, useState } from 'react';

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

const SETTINGS_SECTIONS = [
  ['overview', 'Overview'],
  ['network', 'Network'],
  ['displays', 'Displays'],
  ['google', 'Google Photos'],
  ['security', 'Security & Cloud'],
  ['queue', 'Upload queue'],
] as const;

function sentenceCase(value: string): string {
  const normalized = value.replaceAll('_', ' ');
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
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
    recruitmentButtonText: string;
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
  const [googleFormsUrl, setGoogleFormsUrl] = useState(settings.googleFormsUrl ?? '');
  const [recruitmentButtonText, setRecruitmentButtonText] = useState(
    settings.recruitmentButtonText,
  );
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
          setGoogleFeedback(
            'No albums found in your Google Photos library. Use "Create & Select" above to make one.',
          );
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
        setGoogleFeedback(
          `Sync complete: ${res.data.succeeded} uploaded, ${res.data.failed} failed (${res.data.processed} processed).`,
        );
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
    const baseUrl = supabaseUrl
      ? supabaseUrl.replace(/\/$/, '')
      : 'https://bejgkclvsfbkpkflftxu.supabase.co';
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
    const trimmedUrl = googleFormsUrl.trim();
    const trimmedButtonText = recruitmentButtonText.trim();
    if (
      trimmedButtonText.length === 0 ||
      trimmedButtonText.length > 80 ||
      /[\r\n]/u.test(trimmedButtonText)
    ) {
      setLocalError('Ministry button text must be a single line containing 1–80 characters.');
      return;
    }
    let validatedUrl: string | null = null;
    if (trimmedUrl.length > 0) {
      if (trimmedUrl.length > 2048) {
        setLocalError('Join a ministry URL must not exceed 2048 characters.');
        return;
      }
      try {
        const parsed = new URL(trimmedUrl);
        if (
          parsed.protocol !== 'https:' ||
          parsed.username !== '' ||
          parsed.password !== '' ||
          (parsed.port !== '' && parsed.port !== '443') ||
          parsed.hostname.length === 0
        ) {
          setLocalError(
            'Join a ministry URL must be a valid HTTPS URL without credentials or custom ports.',
          );
          return;
        }
        validatedUrl = parsed.toString();
      } catch {
        setLocalError('Join a ministry URL must be a valid HTTPS URL.');
        return;
      }
    }
    onSaveSettings({
      googleFormsUrl: validatedUrl,
      recruitmentButtonText: trimmedButtonText,
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

  const scrollRef = useRef<HTMLDivElement>(null);
  const jumpToSection = (id: string) => {
    const container = scrollRef.current;
    const section = document.getElementById(`settings-${id}`);
    if (!container || !section) return;
    const top =
      section.getBoundingClientRect().top -
      container.getBoundingClientRect().top +
      container.scrollTop;
    container.scrollTo({ top: top - 56, behavior: 'smooth' });
    section.querySelector<HTMLElement>('.account-section__label')?.focus({ preventScroll: true });
  };

  const healthStates = (Object.keys(HEALTH_ICONS) as (keyof typeof HEALTH_ICONS)[]).map(
    (key) => health?.[key].state ?? 'unavailable',
  );
  const attentionCount = healthStates.filter((state) => state !== 'healthy').length;
  const allHealthy = attentionCount === 0;

  return (
    <div className="admin-settings" data-testid="admin-settings">
      <header className="admin-page-header admin-page-header--settings">
        <div>
          <h1 data-screen-heading tabIndex={-1}>
            Settings and health
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
      <div className="settings-scroll" ref={scrollRef}>
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

        <nav className="account-jump" aria-label="Settings sections">
          {SETTINGS_SECTIONS.map(([id, label]) => (
            <a
              href={`#settings-${id}`}
              key={id}
              onClick={(event) => {
                event.preventDefault();
                jumpToSection(id);
              }}
            >
              {label}
            </a>
          ))}
        </nav>

        <div className="account-page">
          <section
            className="account-section account-section--overview"
            id="settings-overview"
            aria-labelledby="settings-overview-label"
          >
            <h2 className="account-section__label" id="settings-overview-label" tabIndex={-1}>
              Overview
            </h2>
            <div className="account-section__body">
              <div className="ops-overview">
                <section className="ops-overview__summary" aria-labelledby="ops-greeting">
                  <span
                    className={`ops-overview__badge${allHealthy ? ' is-healthy' : ''}`}
                    aria-hidden="true"
                  >
                    <Camera />
                  </span>
                  <h3 id="ops-greeting">
                    Hi, operator. <span>Here’s how the booth is doing.</span>
                  </h3>
                  <p className={`ops-overview__verdict${allHealthy ? ' is-healthy' : ''}`}>
                    {allHealthy
                      ? 'All systems working'
                      : `${attentionCount} ${attentionCount === 1 ? 'system needs' : 'systems need'} attention`}
                  </p>
                  <dl className="ops-facts">
                    <div>
                      <dt>Camera</dt>
                      <dd>
                        {settings.cameraAdapter === 'sony'
                          ? 'Sony A7 Mirrorless'
                          : settings.cameraAdapter === 'mock'
                            ? 'Mock Camera'
                            : 'Laptop / Internal Webcam'}{' '}
                        · {settings.cameraResolution}
                        {onOpenCameras ? (
                          <button className="ops-link" onClick={onOpenCameras} type="button">
                            Configure camera and test feed
                          </button>
                        ) : null}
                      </dd>
                    </div>
                    <div>
                      <dt>Retention</dt>
                      <dd>
                        Photos {settings.localRetentionDays} days · Links{' '}
                        {settings.cloudRetentionDays} days
                        <small>Fixed for every event</small>
                      </dd>
                    </div>
                  </dl>
                </section>

                <section className="ops-status" aria-labelledby="health-title">
                  <h3 id="health-title">
                    Status. <span>Everything this booth relies on.</span>
                  </h3>
                  <ul className="ops-status__list">
                    {(Object.keys(HEALTH_ICONS) as (keyof typeof HEALTH_ICONS)[]).map((key) => {
                      const Icon = HEALTH_ICONS[key];
                      const service = health?.[key];
                      const state = service?.state ?? 'unavailable';
                      return (
                        <li className="ops-status__row" key={key}>
                          <span className="ops-status__icon" aria-hidden="true">
                            <Icon />
                          </span>
                          <span className="ops-status__text">
                            <strong>{sentenceCase(key)}</strong>
                            <span>{service?.message ?? 'Subsystem telemetry offline.'}</span>
                          </span>
                          <span className={`health-state health-state--${state}`}>
                            {sentenceCase(state)}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              </div>
            </div>
          </section>

          <section
            className="account-section"
            id="settings-network"
            aria-labelledby="settings-network-label"
          >
            <h2 className="account-section__label" id="settings-network-label" tabIndex={-1}>
              Network
            </h2>
            <div className="account-section__body">
              <Form className="settings-card settings-form" noValidate onSubmit={saveSettings}>
                <div className="settings-card__title">
                  <LinkSimple aria-hidden="true" weight="bold" />
                  <div>
                    <h3>Network &amp; delivery</h3>
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
                    <Switch checked={lanEnabled} onCheckedChange={setLanEnabled} />
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
                    <FieldDescription>
                      Used once to import the protected certificate.
                    </FieldDescription>
                  </Field>
                </Fieldset>
                <Fieldset className="lan-fieldset">
                  <FieldsetLegend>Ministry recruitment</FieldsetLegend>
                  <Field
                    invalid={Boolean(localError?.includes('button text'))}
                    name="recruitment-button-text"
                  >
                    <FieldLabel>Recruitment button text</FieldLabel>
                    <Input
                      maxLength={80}
                      onChange={(event) => setRecruitmentButtonText(event.target.value)}
                      placeholder="Join a ministry"
                      required
                      type="text"
                      value={recruitmentButtonText}
                    />
                    <FieldDescription>
                      Required single-line label shown on guest download pages (maximum 80
                      characters).
                    </FieldDescription>
                    {localError?.includes('button text') ? (
                      <FieldError>{localError}</FieldError>
                    ) : null}
                  </Field>
                  <Field invalid={Boolean(localError?.includes('URL'))} name="google-forms-url">
                    <FieldLabel>Join a ministry URL</FieldLabel>
                    <Input
                      onChange={(event) => setGoogleFormsUrl(event.target.value)}
                      placeholder="https://volunteer-management.ccf.org.ph/recruitment/form"
                      type="url"
                      value={googleFormsUrl}
                    />
                    <FieldDescription>
                      Destination URL for the &quot;Join a ministry&quot; link on guest download
                      pages (must be HTTPS). Leave blank for default.
                    </FieldDescription>
                    {localError?.includes('URL') ? <FieldError>{localError}</FieldError> : null}
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
            </div>
          </section>

          <section
            className="account-section"
            id="settings-displays"
            aria-labelledby="settings-displays-label"
          >
            <h2 className="account-section__label" id="settings-displays-label" tabIndex={-1}>
              Displays
            </h2>
            <div className="account-section__body">
              <Form className="settings-card settings-form" onSubmit={handleSaveDualDisplay}>
                <div className="settings-card__title">
                  <Desktop aria-hidden="true" weight="bold" />
                  <div>
                    <h3>Dual-Monitor Setup</h3>
                    <p>
                      Configure Screen 1 (Capture) and Screen 2 (QR Delivery) monitors (
                      {displays.length} detected).
                    </p>
                  </div>
                </div>
                <Field name="dual-mode">
                  <FieldLabel>Dual display mode</FieldLabel>
                  <Select
                    items={[
                      { label: 'Auto (Enabled when 2 monitors connected)', value: 'auto' },
                      { label: 'Force Enabled', value: 'enabled' },
                      { label: 'Disabled (Single Monitor Only)', value: 'disabled' },
                    ]}
                    value={dualMode}
                    onValueChange={(value) => value !== null && setDualMode(value)}
                  >
                    <SelectTrigger aria-label="Dual display mode">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectPopup>
                      {(['auto', 'enabled', 'disabled'] as const).map((value) => (
                        <SelectItem key={value} value={value}>
                          {value === 'auto'
                            ? 'Auto (Enabled when 2 monitors connected)'
                            : value === 'enabled'
                              ? 'Force Enabled'
                              : 'Disabled (Single Monitor Only)'}
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                </Field>
                <Field name="qr-timeout">
                  <FieldLabel>QR auto-dismiss duration</FieldLabel>
                  <Select
                    items={[30, 45, 60, 90].map((value) => ({ label: `${value} seconds`, value }))}
                    value={qrDismissSeconds}
                    onValueChange={(value) => value !== null && setQrDismissSeconds(value)}
                  >
                    <SelectTrigger aria-label="QR auto-dismiss duration">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectPopup>
                      {[30, 45, 60, 90].map((value) => (
                        <SelectItem key={value} value={value}>
                          {value} seconds{value === 45 ? ' (Default)' : ''}
                        </SelectItem>
                      ))}
                    </SelectPopup>
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
            </div>
          </section>

          <section
            className="account-section"
            id="settings-google"
            aria-labelledby="settings-google-label"
          >
            <h2 className="account-section__label" id="settings-google-label" tabIndex={-1}>
              Google Photos
            </h2>
            <div className="account-section__body">
              <Form className="settings-card settings-form" onSubmit={handleSaveGooglePhotos}>
                <div className="settings-card__title">
                  <Images aria-hidden="true" weight="bold" />
                  <div>
                    <h3>Google Photos Shared Album Sync</h3>
                    <p>
                      Live stream completed photo strips into an active Google Photos shared album.
                    </p>
                  </div>
                </div>

                <Field className="form-toggle" name="google-photos-enabled">
                  <label className="switch-row">
                    <span>
                      <strong>Enable Google Photos live sync</strong>
                      <small>Send completed strips to the configured shared album.</small>
                    </span>
                    <Switch
                      checked={googlePhotosEnabled}
                      onCheckedChange={setGooglePhotosEnabled}
                    />
                  </label>
                </Field>

                <label>Google Account Authorization</label>
                <div className="two-field-grid">
                  {googlePhotosEmail ? (
                    <div className="google-account-chip">
                      <CheckCircle aria-hidden="true" />
                      <span>{googlePhotosEmail}</span>
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
                    Google OAuth secrets are missing in Supabase Edge Functions. Please set{' '}
                    <code>GOOGLE_CLIENT_ID</code> and <code>GOOGLE_CLIENT_SECRET</code> in Supabase
                    Secrets.
                  </Alert>
                ) : null}

                {googlePhotosEmail && !hasRefreshToken ? (
                  <Alert variant="error" style={{ marginTop: '0.5rem' }}>
                    Offline background sync permissions are missing. Please click{' '}
                    <strong>Re-authorize</strong> and make sure to grant all Photos permissions.
                  </Alert>
                ) : null}

                <Field name="create-new-album">
                  <FieldLabel>Create new shared event album (Recommended)</FieldLabel>
                  <div className="two-field-grid">
                    <Input
                      type="text"
                      placeholder="e.g. Celebration 2026"
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
                    Creates a dedicated shared album on Google Photos and sets it as the live sync
                    target.
                  </FieldDescription>
                </Field>

                <Alert variant="info" style={{ marginTop: '0.25rem', fontSize: '0.85rem' }}>
                  <strong>Google Photos Integration Policy:</strong> Google Photos API requires the
                  shared album to be created through the Photobooth so that captured photos can be
                  automatically streamed into it during the event.
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
                    <div className="album-picker">
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
                          className={`album-picker__item${
                            googlePhotosAlbumId === alb.id ? ' is-selected' : ''
                          }`}
                        >
                          <strong>{alb.title}</strong>{' '}
                          {alb.shareUrl ? (
                            <span className="album-picker__url">({alb.shareUrl})</span>
                          ) : null}
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
                    <span>
                      Active Target Album: <strong>{googlePhotosAlbumTitle}</strong>
                    </span>
                  </div>
                ) : null}

                <div className="operator-share-hub">
                  <h4 className="operator-share-hub__title">Sync operations and verification</h4>
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
                  <p className="google-feedback" role="status">
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
            </div>
          </section>

          <section
            className="account-section"
            id="settings-queue"
            aria-labelledby="settings-queue-label"
          >
            <h2 className="account-section__label" id="settings-queue-label" tabIndex={-1}>
              Upload queue
            </h2>
            <div className="account-section__body">
              <div className="settings-section">
                <div className="settings-section__heading settings-section__heading--inline">
                  <div>
                    <h3 id="queue-title">Upload queue</h3>
                    <p>
                      {failedJobs.length === 0
                        ? 'No failed uploads need attention.'
                        : `${failedJobs.length} failed upload${failedJobs.length === 1 ? '' : 's'} need attention.`}
                    </p>
                  </div>
                  <span className="telemetry-counter">{jobs.length} recent jobs</span>
                </div>
                <div className="upload-list">
                  {jobs.length === 0 ? (
                    <div className="empty-queue">
                      <Cloud aria-hidden="true" weight="bold" />
                      <strong>The queue is clear</strong>
                      <span>New completed collages will appear here while they upload.</span>
                    </div>
                  ) : (
                    jobs.map((job) => (
                      <article className="upload-job" key={job.id}>
                        <div className="upload-job__state">
                          <Cloud aria-hidden="true" weight="bold" />
                          <div>
                            <strong>{jobLabel(job)}</strong>
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
                          <Badge className={`job-state job-state--${job.state}`}>
                            {jobLabel(job)}
                          </Badge>
                        )}
                      </article>
                    ))
                  )}
                </div>
              </div>
            </div>
          </section>

          <section
            className="account-section"
            id="settings-security"
            aria-labelledby="settings-security-label"
          >
            <h2 className="account-section__label" id="settings-security-label" tabIndex={-1}>
              Security &amp; Cloud
            </h2>
            <div className="account-section__body">
              <section
                className="settings-section settings-section--split"
                aria-label="Secure booth access"
              >
                <Form className="settings-card settings-form" noValidate onSubmit={changePasscode}>
                  <div className="settings-card__title">
                    <Key aria-hidden="true" weight="bold" />
                    <div>
                      <h3>Change passcode</h3>
                      <p>Use at least 8 characters for the shared operator passcode.</p>
                    </div>
                  </div>
                  <Field name="current-passcode">
                    <FieldLabel>Current passcode</FieldLabel>
                    <Input
                      autoComplete="current-password"
                      maxLength={64}
                      minLength={8}
                      onChange={(event) => setCurrentPasscode(event.target.value)}
                      type="password"
                      value={currentPasscode}
                    />
                  </Field>
                  <div className="two-field-grid">
                    <Field name="new-passcode">
                      <FieldLabel>New passcode</FieldLabel>
                      <Input
                        autoComplete="new-password"
                        maxLength={64}
                        minLength={8}
                        onChange={(event) => setNewPasscode(event.target.value)}
                        type="password"
                        value={newPasscode}
                      />
                    </Field>
                    <Field name="confirm-passcode">
                      <FieldLabel>Confirm passcode</FieldLabel>
                      <Input
                        autoComplete="new-password"
                        maxLength={64}
                        minLength={8}
                        onChange={(event) => setConfirmPasscode(event.target.value)}
                        type="password"
                        value={confirmPasscode}
                      />
                    </Field>
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
                      <h3>Cloud connection</h3>
                      <p>
                        Connect the dedicated booth account. Credentials are never displayed again.
                      </p>
                    </div>
                  </div>
                  <Field name="supabase-url">
                    <FieldLabel>Supabase project URL</FieldLabel>
                    <Input
                      onChange={(event) => setSupabaseUrl(event.target.value)}
                      placeholder="https://<project-ref>.supabase.co"
                      type="url"
                      value={supabaseUrl}
                    />
                  </Field>
                  <Field name="supabase-key">
                    <FieldLabel>Supabase publishable / anon key</FieldLabel>
                    <Input
                      onChange={(event) => setSupabasePublishableKey(event.target.value)}
                      placeholder="sb_publishable_... or anon key"
                      type="text"
                      value={supabasePublishableKey}
                    />
                  </Field>
                  <Field name="booth-email">
                    <FieldLabel>Booth account email</FieldLabel>
                    <Input
                      autoComplete="username"
                      onChange={(event) => setEmail(event.target.value)}
                      placeholder="booth@example.com"
                      type="email"
                      value={email}
                    />
                  </Field>
                  <Field name="booth-cloud-password">
                    <FieldLabel>Booth account password</FieldLabel>
                    <Input
                      autoComplete="current-password"
                      onChange={(event) => setCloudPassword(event.target.value)}
                      type="password"
                      value={cloudPassword}
                    />
                  </Field>
                  <Button
                    icon={<ShieldCheck aria-hidden="true" weight="bold" />}
                    loading={busy}
                    type="submit"
                  >
                    Connect cloud
                  </Button>
                </Form>
              </section>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
