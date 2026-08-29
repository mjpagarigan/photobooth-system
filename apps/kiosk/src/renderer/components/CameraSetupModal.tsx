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
import { useEffect, useMemo, useState } from 'react';

import {
  Alert,
  Button,
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
  Field,
  FieldLabel,
  Radio,
  RadioGroup,
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from '@grace-booth/ui';
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
  const deviceItems = useMemo(
    () => [
      { label: 'Default system webcam', value: '' },
      ...videoDevices.map((device) => ({
        label: device.label || `Camera (${device.deviceId.slice(0, 8)})`,
        value: device.deviceId,
      })),
    ],
    [videoDevices],
  );
  const resolutionItems = [
    { label: '720p (1280 × 720) — virtual cameras and testing', value: '720p' as const },
    { label: '1080p (1920 × 1080) — production quality', value: '1080p' as const },
  ];

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
  }, [isOpen]);

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
    <Dialog onOpenChange={(open) => !open && !saving && onClose()} open={isOpen}>
      <DialogPopup className="camera-setup-dialog" maxWidthClass="max-w-4xl" showCloseButton={false}>
        <DialogHeader className="camera-setup-dialog__header">
          <div className="camera-setup-dialog__icon">
            <Camera aria-hidden="true" weight="bold" size={32} />
          </div>
          <div>
            <DialogTitle>Camera configuration</DialogTitle>
            <DialogDescription className="camera-setup-dialog__subtitle">
              Select active optical capture source and verify live telemetry feed.
            </DialogDescription>
          </div>
          <DialogClose
            disabled={saving}
            render={<Button aria-label="Close" size="icon" type="button" variant="ghost" />}
          >
            <X aria-hidden="true" weight="bold" />
          </DialogClose>
        </DialogHeader>

        <DialogPanel className="camera-setup-dialog__content">
          <Field className="camera-adapter-selector">
            <FieldLabel>Camera source</FieldLabel>
            <RadioGroup
              className="camera-source-grid"
              onValueChange={(value) => setSelectedAdapter(value as CameraAdapterKind)}
              value={selectedAdapter === 'internal_webcam' ? 'webcam' : selectedAdapter}
            >
              <label
                className={`camera-source-card ${selectedAdapter === 'webcam' || selectedAdapter === 'internal_webcam' ? 'camera-source-card--active' : ''}`}
              >
                <Radio value="webcam" />
                <VideoCamera size={24} weight="bold" />
                <span className="camera-source-card__title">Laptop / USB Webcam</span>
                <span className="camera-source-card__desc">
                  Internal camera or standard UVC device
                </span>
              </label>

              <label
                className={`camera-source-card ${selectedAdapter === 'sony' ? 'camera-source-card--active' : ''}`}
              >
                <Radio value="sony" />
                <Camera size={24} weight="bold" />
                <span className="camera-source-card__title">Sony A7 Tethered</span>
                <span className="camera-source-card__desc">
                  High-precision Sony Alpha mirrorless
                </span>
              </label>

              <label
                className={`camera-source-card ${selectedAdapter === 'mock' ? 'camera-source-card--active' : ''}`}
              >
                <Radio value="mock" />
                <ArrowsClockwise size={24} weight="bold" />
                <span className="camera-source-card__title">Mock Hardware</span>
                <span className="camera-source-card__desc">Simulated capture for testing</span>
              </label>
            </RadioGroup>
          </Field>

          {(selectedAdapter === 'webcam' || selectedAdapter === 'internal_webcam') && (
            <div className="camera-webcam-section">
              <Field className="camera-device-select-row">
                <FieldLabel>Active device node</FieldLabel>
                <div className="select-with-refresh">
                  <Select
                    items={deviceItems}
                    value={selectedDeviceId ?? ''}
                    onValueChange={(value) => setSelectedDeviceId(value ?? null)}
                  >
                    <SelectTrigger aria-label="Active device node"><SelectValue /></SelectTrigger>
                    <SelectPopup positionerProps={{ alignItemWithTrigger: false }}>
                      {deviceItems.map((item) => (
                        <SelectItem key={item.value ? item.value : 'default'} value={item.value}>{item.label}</SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                  <Button
                    title="Refresh camera devices"
                    aria-label="Refresh camera devices"
                    onClick={() => void loadCameras()}
                    disabled={loading}
                    size="icon"
                    type="button"
                    variant="ghost"
                  >
                    <ArrowsClockwise className={loading ? 'spin' : ''} size={18} weight="bold" />
                  </Button>
                </div>
              </Field>

              <Field className="camera-device-select-row">
                <FieldLabel>Capture resolution</FieldLabel>
                <Select
                  items={resolutionItems}
                  value={selectedResolution}
                  onValueChange={(value) => value !== null && setSelectedResolution(value)}
                >
                  <SelectTrigger aria-label="Capture resolution"><SelectValue /></SelectTrigger>
                  <SelectPopup positionerProps={{ alignItemWithTrigger: false }}>
                    {resolutionItems.map((item) => (
                      <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              </Field>

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
            <Alert className="camera-info-card">
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
            </Alert>
          )}

          {selectedAdapter === 'mock' && (
            <Alert className="camera-info-card">
              <div className="camera-info-card__badge">
                <ArrowsClockwise size={20} weight="bold" />
                <span>MOCK CAMERA EMULATOR</span>
              </div>
              <p>
                Simulates three guest shots using bundled test fixtures. Ideal for offline staging
                and UI verification without hardware.
              </p>
            </Alert>
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
        </DialogPanel>

        <DialogFooter className="camera-setup-dialog__actions">
          <DialogClose disabled={saving} render={<Button type="button" variant="secondary" />}>
            Cancel
          </DialogClose>
          <Button
            loading={saving}
            onClick={handleSave}
            disabled={loading || selectedAdapter === 'sony'}
          >
            Apply &amp; Save
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
