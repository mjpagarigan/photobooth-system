import {
  ArrowClockwiseIcon as ArrowClockwise,
  ArrowsLeftRightIcon as ArrowsLeftRight,
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
import { useEffect, useMemo, useState, type SyntheticEvent } from 'react';

import type {
  AdminHealth,
  AdminSettings as AdminSettingsData,
  DisplayInfo,
  DualDisplayMode,
  UploadJobSummary,
} from '@grace-booth/shared';
import { Button } from '../components/Button';

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
  onRetryJob: (jobId: string) => void;
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
  const [currentPasscode, setCurrentPasscode] = useState('');
  const [newPasscode, setNewPasscode] = useState('');
  const [confirmPasscode, setConfirmPasscode] = useState('');
  const [dualMode, setDualMode] = useState<DualDisplayMode>(settings.dualDisplay?.mode ?? 'auto');
  const [swapDisplays, setSwapDisplays] = useState(settings.dualDisplay?.swapDisplays ?? false);
  const [qrDismissSeconds, setQrDismissSeconds] = useState(settings.dualDisplay?.qrDismissSeconds ?? 45);
  const [displays, setDisplays] = useState<DisplayInfo[]>([]);

  const [googlePhotosEnabled, setGooglePhotosEnabled] = useState(
    settings.googlePhotos?.enabled ?? false,
  );
  const [googlePhotosEmail, setGooglePhotosEmail] = useState(
    settings.googlePhotos?.connectedEmail ?? '',
  );
  const [googlePhotosShareUrl, setGooglePhotosShareUrl] = useState(
    settings.googlePhotos?.albumShareUrl ?? '',
  );
  const [googlePhotosAlbumTitle, setGooglePhotosAlbumTitle] = useState(
    settings.googlePhotos?.albumTitle ?? '',
  );
  const [googlePhotosAlbumId, setGooglePhotosAlbumId] = useState(
    settings.googlePhotos?.albumId ?? '',
  );
  const [googleStats, setGoogleStats] = useState({
    syncedCount: 0,
    pendingCount: 0,
    failedCount: 0,
  });
  const [copiedLink, setCopiedLink] = useState(false);
  const [googleFeedback, setGoogleFeedback] = useState<string | null>(null);

  useEffect(() => {
    const bridge = window.graceBooth;
    if (bridge?.admin.getGooglePhotosStatus) {
      void bridge.admin.getGooglePhotosStatus().then((res) => {
        if (res.ok) {
          setGooglePhotosEnabled(res.data.config.enabled);
          setGooglePhotosEmail(res.data.config.connectedEmail ?? '');
          setGooglePhotosShareUrl(res.data.config.albumShareUrl ?? '');
          setGooglePhotosAlbumTitle(res.data.config.albumTitle ?? '');
          setGooglePhotosAlbumId(res.data.config.albumId ?? '');
          setGoogleStats(res.data.stats);
        }
      });
    }
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
        setGoogleFeedback('Could not resolve album link.');
      }
    } catch {
      setGoogleFeedback('Error resolving album link.');
    }
  };

  const handleSaveGooglePhotos = async (e: SyntheticEvent) => {
    e.preventDefault();
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
    const clientId = '823749351705-qku7r1r57gulhi8kdfblq0nau3v39ecl.apps.googleusercontent.com';
    const baseUrl = supabaseUrl ? supabaseUrl.replace(/\/$/, '') : 'https://bejgkclvsfbkpkflftxu.supabase.co';
    const redirectUri = `${baseUrl}/functions/v1/google-photos-auth`;
    const scope = encodeURIComponent(
      'https://www.googleapis.com/auth/photoslibrary.appendonly https://www.googleapis.com/auth/photoslibrary.readonly.appcreateddata https://www.googleapis.com/auth/userinfo.email',
    );
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(
      redirectUri,
    )}&response_type=code&scope=${scope}&access_type=offline&prompt=consent`;

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

  const handleTestGoogleUpload = async () => {
    const bridge = window.graceBooth;
    if (!bridge?.admin.testGooglePhotosUpload) return;
    setGoogleFeedback('Sending test photo...');
    try {
      const res = await bridge.admin.testGooglePhotosUpload();
      if (res.ok) {
        setGoogleFeedback(res.data.message);
      } else {
        setGoogleFeedback('Test photo failed.');
      }
    } catch {
      setGoogleFeedback('Test photo failed.');
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

  const handleSaveDualDisplay = async (e: SyntheticEvent) => {
    e.preventDefault();
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

  const saveSettings = (event: SyntheticEvent<HTMLFormElement, SubmitEvent>) => {
    event.preventDefault();
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

  const changePasscode = (event: SyntheticEvent<HTMLFormElement, SubmitEvent>) => {
    event.preventDefault();
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

  const connectCloud = (event: SyntheticEvent<HTMLFormElement, SubmitEvent>) => {
    event.preventDefault();
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
        <Button
          icon={<ArrowClockwise aria-hidden="true" weight="bold" />}
          disabled={busy}
          onClick={onRefresh}
          variant="secondary"
        >
          Refresh status
        </Button>
      </header>
      <div className="settings-scroll">
        {status ? (
          <p className="settings-banner settings-banner--success" role="status">
            {status}
          </p>
        ) : null}
        {(localError ?? error) ? (
          <p className="settings-banner settings-banner--error" role="alert">
            {localError ?? error}
          </p>
        ) : null}

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

        <section
          className="settings-section settings-section--split"
          aria-label="Photo delivery and retention"
        >
          <form className="settings-card settings-form" onSubmit={saveSettings}>
            <div className="settings-card__title">
              <LinkSimple aria-hidden="true" weight="bold" />
              <div>
                <h2>Network &amp; delivery</h2>
                <p>Configure local network access for kiosk operations.</p>
              </div>
            </div>
            <fieldset className="lan-fieldset">
              <legend>Trusted network access</legend>
              <label className="switch-row">
                <span>
                  <strong>Allow LAN admin access</strong>
                  <small>Off by default. Enable only on a trusted private network.</small>
                </span>
                <input
                  checked={lanEnabled}
                  onChange={(event) => setLanEnabled(event.target.checked)}
                  role="switch"
                  type="checkbox"
                />
              </label>
              <div className="two-field-grid">
                <label>
                  Bind address
                  <input
                    disabled={!lanEnabled}
                    onChange={(event) => setLanBindHost(event.target.value)}
                    value={lanBindHost}
                  />
                </label>
                <label>
                  Port
                  <input
                    disabled={!lanEnabled}
                    max="65535"
                    min="1024"
                    onChange={(event) => setLanPort(event.target.value)}
                    type="number"
                    value={lanPort}
                  />
                </label>
              </div>
              <p className="certificate-state">
                <ShieldCheck aria-hidden="true" weight="bold" />
                {settings.lan.tlsConfigured
                  ? 'TLS certificate configured'
                  : 'TLS certificate required before LAN access'}
              </p>
              <label htmlFor="certificate-passphrase">Certificate passphrase</label>
              <div className="certificate-actions">
                <input
                  autoComplete="new-password"
                  id="certificate-passphrase"
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
            </fieldset>
            <Button
              icon={<CheckCircle aria-hidden="true" weight="bold" />}
              loading={busy}
              type="submit"
            >
              Save settings
            </Button>
          </form>

          <form className="settings-card settings-form" onSubmit={handleSaveDualDisplay}>
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
            <label htmlFor="dual-mode">Dual Display Mode</label>
            <select
              id="dual-mode"
              value={dualMode}
              onChange={(e) => setDualMode(e.target.value as DualDisplayMode)}
            >
              <option value="auto">Auto (Enabled when 2 monitors connected)</option>
              <option value="enabled">Force Enabled</option>
              <option value="disabled">Disabled (Single Monitor Only)</option>
            </select>
            <label htmlFor="qr-timeout">QR Auto-Dismiss Duration</label>
            <select
              id="qr-timeout"
              value={qrDismissSeconds}
              onChange={(e) => setQrDismissSeconds(Number(e.target.value))}
            >
              <option value={30}>30 seconds</option>
              <option value={45}>45 seconds (Default)</option>
              <option value={60}>60 seconds</option>
              <option value={90}>90 seconds</option>
            </select>
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
          </form>

          <form className="settings-card settings-form" onSubmit={handleSaveGooglePhotos}>
            <div className="settings-card__title">
              <Images aria-hidden="true" weight="bold" />
              <div>
                <h2>Google Photos Shared Album Sync</h2>
                <p>Live stream completed photo strips into an active Google Photos album.</p>
              </div>
            </div>

            <div className="form-toggle">
              <label htmlFor="google-photos-enabled">
                <input
                  id="google-photos-enabled"
                  type="checkbox"
                  checked={googlePhotosEnabled}
                  onChange={(e) => setGooglePhotosEnabled(e.target.checked)}
                />
                <strong>Enable Google Photos Live Sync</strong>
              </label>
            </div>

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
              {googlePhotosEmail ? (
                <Button
                  icon={<Trash aria-hidden="true" weight="bold" />}
                  onClick={handleDisconnectGoogle}
                  type="button"
                  variant="secondary"
                >
                  Disconnect
                </Button>
              ) : (
                <Button
                  icon={<ArrowClockwise aria-hidden="true" weight="bold" />}
                  onClick={onRefresh}
                  type="button"
                  variant="secondary"
                >
                  Check Auth Status
                </Button>
              )}
            </div>

            <label htmlFor="google-album-url">Google Photos Shared Album Link</label>
            <div className="two-field-grid">
              <input
                id="google-album-url"
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
                Resolve
              </Button>
            </div>

            {googlePhotosAlbumTitle ? (
              <div className="info-banner" style={{ marginTop: '0.5rem' }}>
                <CheckCircle aria-hidden="true" weight="bold" />
                <span>Active Target: <strong>{googlePhotosAlbumTitle}</strong></span>
              </div>
            ) : null}

            {googlePhotosShareUrl ? (
              <div className="operator-share-hub" style={{ marginTop: '1rem', padding: '0.75rem', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                  <span style={{ fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>
                    Operator Share Hub (For Guests Without Camera QR)
                  </span>
                </div>
                <div className="two-field-grid">
                  <Button
                    icon={<Copy aria-hidden="true" weight="bold" />}
                    onClick={handleCopyAlbumLink}
                    type="button"
                    variant="secondary"
                  >
                    {copiedLink ? 'Copied to Clipboard!' : 'Copy Album Link'}
                  </Button>
                  <Button
                    icon={<PaperPlaneTilt aria-hidden="true" weight="bold" />}
                    onClick={handleTestGoogleUpload}
                    type="button"
                    variant="secondary"
                  >
                    Send Test Photo
                  </Button>
                </div>
              </div>
            ) : null}

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
          </form>

          <article className="settings-card retention-card">
            <div className="settings-card__title">
              <FileLock aria-hidden="true" weight="bold" />
              <div>
                <h2>Retention</h2>
                <p>Locked privacy windows for every guest photo.</p>
              </div>
            </div>
            <div className="retention-values">
              <div>
                <strong>{settings.cloudRetentionDays}</strong>
                <span>days in cloud storage</span>
              </div>
              <div>
                <strong>{settings.localRetentionDays}</strong>
                <span>days on this booth</span>
              </div>
            </div>
            <p>
              <LockKey aria-hidden="true" weight="bold" /> Retention periods cannot be changed from
              the booth.
            </p>
          </article>
        </section>

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
                      onClick={() => onRetryJob(job.id)}
                      variant="secondary"
                    >
                      Retry upload
                    </Button>
                  ) : (
                    <span className={`job-state job-state--${job.state}`}>{jobLabel(job)}</span>
                  )}
                </article>
              ))
            )}
          </div>
        </section>

        <section
          className="settings-section settings-section--split"
          aria-label="Secure booth access"
        >
          <form className="settings-card settings-form" onSubmit={changePasscode}>
            <div className="settings-card__title">
              <Key aria-hidden="true" weight="bold" />
              <div>
                <h2>Change passcode</h2>
                <p>Use at least 8 characters for the shared operator passcode.</p>
              </div>
            </div>
            <label htmlFor="current-passcode">Current passcode</label>
            <input
              autoComplete="current-password"
              id="current-passcode"
              maxLength={64}
              minLength={8}
              onChange={(event) => setCurrentPasscode(event.target.value)}
              type="password"
              value={currentPasscode}
            />
            <div className="two-field-grid">
              <label>
                New passcode
                <input
                  autoComplete="new-password"
                  maxLength={64}
                  minLength={8}
                  onChange={(event) => setNewPasscode(event.target.value)}
                  type="password"
                  value={newPasscode}
                />
              </label>
              <label>
                Confirm passcode
                <input
                  autoComplete="new-password"
                  maxLength={64}
                  minLength={8}
                  onChange={(event) => setConfirmPasscode(event.target.value)}
                  type="password"
                  value={confirmPasscode}
                />
              </label>
            </div>
            <Button
              icon={<LockKey aria-hidden="true" weight="bold" />}
              loading={busy}
              type="submit"
            >
              Change passcode
            </Button>
          </form>

          <form className="settings-card settings-form" onSubmit={connectCloud}>
            <div className="settings-card__title">
              <WifiHigh aria-hidden="true" weight="bold" />
              <div>
                <h2>Cloud connection</h2>
                <p>Connect the dedicated booth account. Credentials are never displayed again.</p>
              </div>
            </div>
            <label htmlFor="supabase-url">Supabase Project URL</label>
            <input
              id="supabase-url"
              onChange={(event) => setSupabaseUrl(event.target.value)}
              placeholder="https://<project-ref>.supabase.co"
              type="url"
              value={supabaseUrl}
            />
            <label htmlFor="supabase-key">Supabase Publishable / Anon Key</label>
            <input
              id="supabase-key"
              onChange={(event) => setSupabasePublishableKey(event.target.value)}
              placeholder="sb_publishable_... or anon key"
              type="text"
              value={supabasePublishableKey}
            />
            <label htmlFor="booth-email">Booth account email</label>
            <input
              autoComplete="username"
              id="booth-email"
              onChange={(event) => setEmail(event.target.value)}
              placeholder="booth@example.com"
              type="email"
              value={email}
            />
            <label htmlFor="booth-cloud-password">Booth account password</label>
            <input
              autoComplete="current-password"
              id="booth-cloud-password"
              onChange={(event) => setCloudPassword(event.target.value)}
              type="password"
              value={cloudPassword}
            />
            <Button
              icon={<ShieldCheck aria-hidden="true" weight="bold" />}
              loading={busy}
              type="submit"
            >
              Connect cloud
            </Button>
          </form>
        </section>
      </div>
    </div>
  );
}
