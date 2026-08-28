import {
  CAMERA_RESOLUTION_DIMENSIONS,
  isWebcamCameraAdapter,
  type CameraAdapterKind,
  type CameraDevice,
  type CameraResolution,
  type CameraStatus,
} from '@grace-booth/shared';
import {
  CameraIcon as Camera,
  CheckCircleIcon as CheckCircle,
  VideoCameraIcon as VideoCamera,
  XIcon as X,
  WarningCircleIcon as WarningCircle,
  ArrowsClockwiseIcon as ArrowsClockwise,
} from '@phosphor-icons/react';
import { useEffect, useId, useRef, useState } from 'react';

import { Button } from './Button';
import { enumerateVideoDevices, useCameraStream } from '../hooks/useCameraStream';

type CameraSetupModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onCameraSaved?: (
    adapter: CameraAdapterKind,
    deviceId: string | null,
    resolution: CameraResolution,
  ) => void;
};

export function CameraSetupModal({ isOpen, onClose, onCameraSaved }: CameraSetupModalProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const descriptionId = useId();
  const [selectedAdapter, setSelectedAdapter] = useState<CameraAdapterKind>('webcam');
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [selectedResolution, setSelectedResolution] = useState<CameraResolution>('1080p');
  const [videoDevices, setVideoDevices] = useState<CameraDevice[]>([]);
  const [cameraStatus, setCameraStatus] = useState<CameraStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [configurationLoaded, setConfigurationLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const webcamSelected = isWebcamCameraAdapter(selectedAdapter);
  const previewEnabled = isOpen && configurationLoaded && webcamSelected;
  const cameraStream = useCameraStream(previewEnabled, selectedDeviceId, selectedResolution);

  const loadCameras = async () => {
    if (typeof window === 'undefined' || !window.graceBooth) return;
    setLoading(true);
    setError(null);
    try {
      const [configResult, devices] = await Promise.all([
        window.graceBooth.booth.getCameras(),
        enumerateVideoDevices(),
      ]);
      setVideoDevices(devices);
      if (configResult.ok) {
        setSelectedAdapter(configResult.data.adapter);
        setSelectedDeviceId(configResult.data.deviceId);
        setSelectedResolution(configResult.data.resolution);
        setCameraStatus(configResult.data.status);
      }
    } catch {
      setError('Could not query connected camera devices.');
    } finally {
      setLoading(false);
      setConfigurationLoaded(true);
    }
  };

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    setConfigurationLoaded(false);
    void loadCameras();
    setSuccessMessage(null);
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => {
      previouslyFocused?.focus();
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const focusFrame = requestAnimationFrame(() => {
      dialogRef.current?.querySelector<HTMLElement>('button:not(:disabled)')?.focus();
    });

    return () => cancelAnimationFrame(focusFrame);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== 'Tab') {
        return;
      }

      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((element) => element.getAttribute('aria-hidden') !== 'true');
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [isOpen, saving, onClose]);

  if (!isOpen) return null;

  const handleSave = async () => {
    if (!window.graceBooth || selectedAdapter === 'sony') return;
    setSaving(true);
    setError(null);
    setSuccessMessage(null);
    try {
      const result = await window.graceBooth.booth.setCamera({
        adapter: selectedAdapter,
        deviceId: selectedDeviceId,
        resolution: selectedResolution,
      });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setCameraStatus(result.data.status);
      setSuccessMessage('Camera configuration saved successfully.');
      onCameraSaved?.(selectedAdapter, selectedDeviceId, selectedResolution);
      setTimeout(() => {
        onClose();
      }, 700);
    } catch {
      setError('Failed to apply camera settings.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        className="camera-setup-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="camera-setup-title"
        aria-describedby={descriptionId}
        ref={dialogRef}
      >
        <button
          aria-label="Close"
          className="icon-button passcode-dialog__close"
          disabled={saving}
          onClick={onClose}
        >
          <X aria-hidden="true" weight="bold" />
        </button>

        <div className="camera-setup-dialog__header">
          <div className="camera-setup-dialog__icon">
            <Camera aria-hidden="true" weight="bold" size={32} />
          </div>
          <div>
            <h2 id="camera-setup-title">Camera Configuration</h2>
            <p id={descriptionId} className="camera-setup-dialog__subtitle">
              Select active optical capture source and verify live telemetry feed.
            </p>
          </div>
        </div>

        <div className="camera-setup-dialog__content">
          <div className="camera-adapter-selector">
            <label className="field-label">Camera Source</label>
            <div className="camera-source-grid">
              <button
                type="button"
                className={`camera-source-card ${selectedAdapter === 'webcam' || selectedAdapter === 'internal_webcam' ? 'camera-source-card--active' : ''}`}
                onClick={() => setSelectedAdapter('webcam')}
              >
                <VideoCamera size={24} weight="bold" />
                <span className="camera-source-card__title">Laptop / USB Webcam</span>
                <span className="camera-source-card__desc">
                  Internal camera or standard UVC device
                </span>
              </button>

              <button
                type="button"
                className={`camera-source-card ${selectedAdapter === 'sony' ? 'camera-source-card--active' : ''}`}
                onClick={() => setSelectedAdapter('sony')}
              >
                <Camera size={24} weight="bold" />
                <span className="camera-source-card__title">Sony A7 Tethered</span>
                <span className="camera-source-card__desc">
                  High-precision Sony Alpha mirrorless
                </span>
              </button>

              <button
                type="button"
                className={`camera-source-card ${selectedAdapter === 'mock' ? 'camera-source-card--active' : ''}`}
                onClick={() => setSelectedAdapter('mock')}
              >
                <ArrowsClockwise size={24} weight="bold" />
                <span className="camera-source-card__title">Mock Hardware</span>
                <span className="camera-source-card__desc">Simulated capture for testing</span>
              </button>
            </div>
          </div>

          {(selectedAdapter === 'webcam' || selectedAdapter === 'internal_webcam') && (
            <div className="camera-webcam-section">
              <div className="camera-device-select-row">
                <label htmlFor="camera-device-select" className="field-label">
                  Active Device Node
                </label>
                <div className="select-with-refresh">
                  <select
                    id="camera-device-select"
                    className="select-input"
                    value={selectedDeviceId ?? ''}
                    onChange={(e) => setSelectedDeviceId(e.target.value || null)}
                  >
                    <option value="">Default System Webcam</option>
                    {videoDevices.map((device) => (
                      <option key={device.deviceId} value={device.deviceId}>
                        {device.label || `Camera (${device.deviceId.slice(0, 8)})`}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="icon-button"
                    title="Refresh camera devices"
                    aria-label="Refresh camera devices"
                    onClick={() => void loadCameras()}
                    disabled={loading}
                  >
                    <ArrowsClockwise className={loading ? 'spin' : ''} size={18} weight="bold" />
                  </button>
                </div>
              </div>

              <div className="camera-device-select-row">
                <label htmlFor="camera-resolution-select" className="field-label">
                  Capture Resolution
                </label>
                <select
                  id="camera-resolution-select"
                  className="select-input"
                  value={selectedResolution}
                  onChange={(event) =>
                    setSelectedResolution(event.target.value === '720p' ? '720p' : '1080p')
                  }
                >
                  <option value="720p">720p (1280 × 720) — virtual cameras and testing</option>
                  <option value="1080p">1080p (1920 × 1080) — production quality</option>
                </select>
              </div>

              <div className="camera-preview-container">
                <div className="camera-preview-box">
                  <video
                    ref={cameraStream.videoRef}
                    autoPlay
                    playsInline
                    muted
                    className="camera-preview-video"
                  />
                  <div
                    className="camera-preview-box__crosshair camera-preview-box__crosshair--tl"
                    aria-hidden="true"
                  >
                    +
                  </div>
                  <div
                    className="camera-preview-box__crosshair camera-preview-box__crosshair--tr"
                    aria-hidden="true"
                  >
                    +
                  </div>
                  <div
                    className="camera-preview-box__crosshair camera-preview-box__crosshair--bl"
                    aria-hidden="true"
                  >
                    +
                  </div>
                  <div
                    className="camera-preview-box__crosshair camera-preview-box__crosshair--br"
                    aria-hidden="true"
                  >
                    +
                  </div>
                  {cameraStream.acquisitionState === 'initializing' && (
                    <div className="camera-preview-overlay">
                      <span>Preparing USB Streaming preview…</span>
                    </div>
                  )}
                  {cameraStream.acquisitionState === 'permission-denied' && (
                    <div
                      className="camera-preview-overlay camera-preview-overlay--warning"
                      role="alert"
                    >
                      <WarningCircle size={24} weight="bold" />
                      <span>Camera permission was denied.</span>
                    </div>
                  )}
                  {cameraStream.acquisitionState === 'unavailable' && (
                    <div
                      className="camera-preview-overlay camera-preview-overlay--warning"
                      role="alert"
                    >
                      <WarningCircle size={24} weight="bold" />
                      <span>The camera is unavailable or in use by another app.</span>
                    </div>
                  )}
                </div>
                <div
                  className={`camera-preview-caption camera-preview-caption--${cameraStream.acquisitionState}`}
                  role={
                    cameraStream.acquisitionState === 'permission-denied' ||
                    cameraStream.acquisitionState === 'unavailable'
                      ? 'alert'
                      : 'status'
                  }
                  aria-live="polite"
                >
                  <span>
                    Actual:{' '}
                    <strong>
                      {cameraStream.resolution
                        ? `${cameraStream.resolution.width} × ${cameraStream.resolution.height}`
                        : 'Waiting for camera'}
                    </strong>
                  </span>
                  <span>
                    Requested:{' '}
                    <strong>
                      {CAMERA_RESOLUTION_DIMENSIONS[selectedResolution].width} ×{' '}
                      {CAMERA_RESOLUTION_DIMENSIONS[selectedResolution].height}
                    </strong>
                  </span>
                  <span>
                    {cameraStream.acquisitionState === 'ready'
                      ? 'Live preview connected.'
                      : cameraStream.acquisitionState === 'permission-denied'
                        ? 'Allow camera access in Windows and reopen Camera Settings.'
                        : cameraStream.acquisitionState === 'unavailable'
                          ? 'Close other camera apps or reconnect the USB camera.'
                          : 'Negotiating the selected camera mode.'}
                  </span>
                </div>
              </div>
            </div>
          )}

          {selectedAdapter === 'sony' && (
            <div className="camera-info-card">
              <div className="camera-info-card__badge">
                <WarningCircle size={20} weight="bold" />
                <span>NATIVE SONY PC REMOTE ADAPTER — NOT AVAILABLE</span>
              </div>
              <p>Use the Sony ILCE-7M4 as a standard webcam instead:</p>
              <ul className="camera-info-card__list">
                <li>
                  Select <strong>Laptop / USB Webcam</strong> above.
                </li>
                <li>
                  Set the camera to <strong>1080p USB Streaming</strong>, not PC Remote.
                </li>
                <li>Use a USB 3 / SuperSpeed connection and select the Sony UVC device.</li>
              </ul>
              {cameraStatus && (
                <div className="camera-status-pill">
                  STATUS: <strong>{cameraStatus.state.toUpperCase()}</strong> (
                  {cameraStatus.operatorMessage})
                </div>
              )}
            </div>
          )}

          {selectedAdapter === 'mock' && (
            <div className="camera-info-card">
              <div className="camera-info-card__badge">
                <ArrowsClockwise size={20} weight="bold" />
                <span>MOCK CAMERA EMULATOR</span>
              </div>
              <p>
                Simulates three guest shots using bundled test fixtures. Ideal for offline staging
                and UI verification without hardware.
              </p>
            </div>
          )}

          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}

          {successMessage && (
            <div className="form-success" role="status">
              <CheckCircle size={18} weight="bold" />
              <span>{successMessage}</span>
            </div>
          )}
        </div>

        <div className="camera-setup-dialog__actions">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            loading={saving}
            onClick={handleSave}
            disabled={loading || selectedAdapter === 'sony'}
          >
            Apply &amp; Save
          </Button>
        </div>
      </section>
    </div>
  );
}
