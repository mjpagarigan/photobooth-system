import {
  BOOTH_SNAPSHOT_EVENT,
  BoothSnapshotEventSchema,
  CAMERA_FRAME_REQUEST_EVENT,
  CameraFrameRequestEventSchema,
  CAMERA_PREVIEW_FRAME_EVENT,
  CameraPreviewFrameEventSchema,
  PRINTER_HEALTH_EVENT,
  PrinterHealthEventSchema,
  QR_STATION_EVENT,
  QrStationEventSchema,
  IpcContracts,
  type GraceBoothBridge,
  type IpcChannel,
  type IpcRequest,
  type IpcResponse,
} from '@grace-booth/shared';
import { contextBridge, ipcRenderer } from 'electron';

async function invoke<C extends IpcChannel>(
  channel: C,
  input: IpcRequest<C>,
): Promise<IpcResponse<C>> {
  const validatedInput = IpcContracts[channel].request.safeParse(input);
  if (!validatedInput.success) {
    const issues = validatedInput.error.issues
      .map((i) => (i.path.length > 0 ? `${i.path.join('.')}: ${i.message}` : i.message))
      .join(', ');
    return {
      ok: false,
      error: { code: 'invalid_request', message: issues || 'Invalid input.', retryable: false },
    } as IpcResponse<C>;
  }
  const untrustedResponse: unknown = await ipcRenderer.invoke(channel, validatedInput.data);
  return IpcContracts[channel].response.parse(untrustedResponse) as IpcResponse<C>;
}

const bridge: GraceBoothBridge = {
  booth: {
    getSnapshot: () => invoke('booth:get-snapshot', {}),
    start: () => invoke('booth:start', {}),
    retakeAll: () => invoke('booth:retake-all', {}),
    acceptPhotos: (input) => invoke('booth:accept-photos', input),
    retryUpload: () => invoke('booth:retry-upload', {}),
    finishOffline: () => invoke('booth:finish-offline', {}),
    done: () => invoke('booth:done', {}),
    cancelSession: () => invoke('booth:cancel-session', {}),
    getCameras: () => invoke('booth:get-cameras', {}),
    setCamera: (input) => invoke('booth:set-camera', input),
    submitCameraFrame: (captureId, jpegBase64) =>
      invoke('booth:submit-camera-frame', { captureId, jpegBase64 }),
    setCameraPreview: (active, adapter) =>
      invoke('booth:set-camera-preview', adapter ? { active, adapter } : { active }),
    subscribe: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, value: unknown): void => {
        const parsed = BoothSnapshotEventSchema.safeParse(value);
        if (parsed.success) listener(parsed.data);
      };
      ipcRenderer.on(BOOTH_SNAPSHOT_EVENT, handler);
      return () => ipcRenderer.removeListener(BOOTH_SNAPSHOT_EVENT, handler);
    },
    onCameraFrameRequest: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, value: unknown): void => {
        const parsed = CameraFrameRequestEventSchema.safeParse(value);
        if (parsed.success) listener(parsed.data);
      };
      ipcRenderer.on(CAMERA_FRAME_REQUEST_EVENT, handler);
      return () => ipcRenderer.removeListener(CAMERA_FRAME_REQUEST_EVENT, handler);
    },
    onCameraPreviewFrame: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, value: unknown): void => {
        const parsed = CameraPreviewFrameEventSchema.safeParse(value);
        if (parsed.success) listener(parsed.data);
      };
      ipcRenderer.on(CAMERA_PREVIEW_FRAME_EVENT, handler);
      return () => ipcRenderer.removeListener(CAMERA_PREVIEW_FRAME_EVENT, handler);
    },
  },
  qrStation: {
    getState: () => invoke('qr-station:get-state', {}),
    dismiss: (sessionId?: string | null) => invoke('qr-station:dismiss', { sessionId }),
    subscribe: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, value: unknown): void => {
        const parsed = QrStationEventSchema.safeParse(value);
        if (parsed.success) listener(parsed.data);
      };
      ipcRenderer.on(QR_STATION_EVENT, handler);
      return () => ipcRenderer.removeListener(QR_STATION_EVENT, handler);
    },
  },
  gallery: {
    getRecent: (limit = 20) => invoke('gallery:get-recent', { limit }),
    repairCloudPhoto: (sessionId) => invoke('gallery:repair-cloud-photo', { sessionId }),
  },
  print: {
    getHealth: () => invoke('print:get-health', {}),
    listJobs: () => invoke('print:list-jobs', {}),
    cancelJob: (jobId) => invoke('print:cancel-job', { jobId }),
    resolveJob: (jobId, resolution) => invoke('print:resolve-job', { jobId, resolution }),
    reprint: (sessionId, copies) => invoke('print:reprint', { sessionId, copies }),
    subscribe: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, value: unknown): void => {
        const parsed = PrinterHealthEventSchema.safeParse(value);
        if (parsed.success) listener(parsed.data);
      };
      ipcRenderer.on(PRINTER_HEALTH_EVENT, handler);
      return () => ipcRenderer.removeListener(PRINTER_HEALTH_EVENT, handler);
    },
  },
  admin: {
    getAuthStatus: () => invoke('admin:get-auth-status', {}),
    login: (passcode) => invoke('admin:login', { passcode }),
    logout: () => invoke('admin:logout', {}),
    bootstrapPasscode: (passcode) => invoke('admin:bootstrap-passcode', { passcode }),
    changePasscode: (currentPasscode, newPasscode) =>
      invoke('admin:change-passcode', { currentPasscode, newPasscode }),
    getSettings: () => invoke('admin:get-settings', {}),
    saveSettings: (input) => invoke('admin:save-settings', input),
    getGooglePhotosStatus: () => invoke('admin:google-photos:get-status', {}),
    saveGooglePhotosConfig: (config) => invoke('admin:google-photos:save-config', config),
    createGooglePhotosAlbum: (title) => invoke('admin:google-photos:create-album', { title }),
    listGooglePhotosAlbums: () => invoke('admin:google-photos:list-albums', {}),
    resolveGooglePhotosAlbum: (shareUrl) =>
      invoke('admin:google-photos:resolve-album', { shareUrl }),
    syncGooglePhotosNow: () => invoke('admin:google-photos:sync-now', {}),
    testGooglePhotosUpload: () => invoke('admin:google-photos:test-upload', {}),
    disconnectGooglePhotos: () => invoke('admin:google-photos:disconnect', {}),
    getDisplays: () => invoke('admin:get-displays', {}),
    swapDisplays: () => invoke('admin:swap-displays', {}),
    saveDualDisplaySettings: (input) => invoke('admin:save-dual-display-settings', input),
    listFrames: () => invoke('admin:list-frames', {}),
    chooseFrame: () => invoke('admin:choose-frame', {}),
    addFrame: (input) => invoke('admin:add-frame', input),
    updateFrameLayout: (input) => invoke('admin:update-frame-layout', input),
    deleteFrame: (frameId) => invoke('admin:delete-frame', { frameId }),
    activateFrame: (frameId) => invoke('admin:activate-frame', { frameId }),
    moveFrame: (input) => invoke('admin:move-frame', input),
    replaceFrameImage: (input) => invoke('admin:replace-frame-image', input),
    chooseLanCertificate: (passphrase) => invoke('admin:choose-lan-certificate', { passphrase }),
    listUploadJobs: (input = {}) => invoke('admin:list-upload-jobs', input),
    retryUpload: (uploadJobId) => invoke('admin:retry-upload', { uploadJobId }),
    getHealth: () => invoke('admin:get-health', {}),
    restartSession: (sessionId) => invoke('admin:restart-session', { sessionId }),
    connectCloud: (email, password, supabaseUrl, supabasePublishableKey) =>
      invoke('admin:connect-cloud', { email, password, supabaseUrl, supabasePublishableKey }),
    openExternalUrl: (url) => invoke('admin:open-external-url', { url }),
    listPrinters: () => invoke('admin:printer:list', {}),
    getPrinterSettings: () => invoke('admin:printer:get-settings', {}),
    getPrinterCapabilities: (printerName) =>
      invoke('admin:printer:get-capabilities', { printerName }),
    savePrinterSettings: (input) => invoke('admin:printer:save-settings', input),
    chooseIccProfile: () => invoke('admin:printer:choose-icc-profile', {}),
    clearIccProfile: () => invoke('admin:printer:clear-icc-profile', {}),
    printTestPage: (kind) => invoke('admin:printer:print-test-page', { kind }),
  },
};

contextBridge.exposeInMainWorld('graceBooth', bridge);
