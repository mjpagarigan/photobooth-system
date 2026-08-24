import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

import {
  BOOTH_SNAPSHOT_EVENT,
  IpcContracts,
  type AdminSettings,
  type IpcChannel,
  type IpcRequest,
  type RpcError,
  type UploadJobSummary,
} from '@grace-booth/shared';
import {
  BrowserWindow,
  dialog,
  ipcMain,
  type IpcMainInvokeEvent,
  type OpenDialogOptions,
} from 'electron';
import { ZodError } from 'zod';

import type { AdminSessionService } from '../auth/admin-sessions.js';
import { assertOperatorBootstrapComplete } from '../auth/bootstrap-guard.js';
import type { LanCertificateService } from '../auth/lan-certificate-service.js';
import type { PasscodeService } from '../auth/passcode-service.js';
import type { DynamicCameraAdapter } from '../camera/dynamic-camera-adapter.js';
import type { RendererFrameBroker } from '../camera/renderer-frame-broker.js';
import type { DeliveryClient } from '../cloud/delivery-client.js';
import type { UploadQueue } from '../cloud/upload-queue.js';
import type { RecentGalleryService } from '../gallery/recent-gallery-service.js';
import type { LocalRepository, StoredUploadJob } from '../database/repositories.js';
import { AppError } from '../errors.js';
import type { FrameService } from '../frame/frame-service.js';
import type { HealthService } from '../health-service.js';
import { assertPrivateIpv4 } from '../server/network-boundary.js';
import type { BoothWorkflow } from '../workflow/booth-workflow.js';
import { assertTrustedIpcSender } from './sender-trust.js';

export type IpcDependencies = {
  workflow: BoothWorkflow;
  camera: DynamicCameraAdapter;
  passcodes: PasscodeService;
  adminSessions: AdminSessionService;
  repository: LocalRepository;
  frameService: FrameService;
  certificates: LanCertificateService;
  health: HealthService;
  delivery: DeliveryClient;
  uploadQueue: UploadQueue;
  cameraFrames: RendererFrameBroker;
  recentGallery: RecentGalleryService;
  rendererOrigin: string;
  onNetworkSettingsChanged(): void;
};

export function registerIpcHandlers(dependencies: IpcDependencies): () => void {
  const channels: IpcChannel[] = [];
  const register = <C extends IpcChannel>(
    channel: C,
    handler: (event: IpcMainInvokeEvent, input: IpcRequest<C>) => unknown,
  ): void => {
    channels.push(channel);
    ipcMain.handle(channel, async (event, untrustedInput: unknown) => {
      try {
        assertTrustedSender(event, dependencies.rendererOrigin);
        const input = IpcContracts[channel].request.parse(untrustedInput) as IpcRequest<C>;
        const data = await handler(event, input);
        return IpcContracts[channel].response.parse({ ok: true, data });
      } catch (error) {
        return IpcContracts[channel].response.parse({ ok: false, error: rpcError(error) });
      }
    });
  };

  const requireAdmin = (event: IpcMainInvokeEvent): void => {
    dependencies.adminSessions.requireRenderer(event.sender.id);
  };

  register('booth:get-snapshot', () => dependencies.workflow.getSnapshot());
  register('booth:start', () => {
    assertOperatorBootstrapComplete(dependencies.passcodes.isConfigured());
    return dependencies.workflow.start();
  });
  register('booth:retake-all', () => dependencies.workflow.retakeAll());
  register('booth:accept-photos', (_event, input) =>
    dependencies.workflow.acceptPhotos(input.frameId),
  );
  register('booth:retry-upload', () => dependencies.workflow.retryUpload());
  register('booth:finish-offline', () => dependencies.workflow.finishOffline());
  register('booth:done', () => dependencies.workflow.done());
  register('booth:cancel-session', () => dependencies.workflow.cancelSession());
  register('booth:get-cameras', async () => {
    const status = await dependencies.camera.getStatus();
    const settings = dependencies.repository.getSettings();
    return {
      adapter: dependencies.camera.getActiveAdapterKind(),
      deviceId: dependencies.camera.getDeviceId(),
      resolution: settings.cameraResolution,
      status,
    };
  });
  register('booth:set-camera', async (_event, input) => {
    const status = await dependencies.camera.switchAdapter(input.adapter, input.deviceId ?? null);
    dependencies.repository.setCameraSettings(
      input.adapter,
      input.deviceId ?? null,
      input.resolution,
    );
    dependencies.workflow.setCameraPreviewEnabled(
      input.adapter === 'webcam' || input.adapter === 'internal_webcam',
    );
    return {
      adapter: input.adapter,
      deviceId: input.deviceId ?? null,
      resolution: input.resolution,
      status,
    };
  });
  register('booth:submit-camera-frame', (_event, input) => {
    dependencies.cameraFrames.submitFrame(input.captureId, Buffer.from(input.jpegBase64, 'base64'));
    return {};
  });

  register('gallery:get-recent', (_event, input) =>
    dependencies.recentGallery.getRecent(input.limit),
  );

  register('admin:get-auth-status', (event) => ({
    configured: dependencies.passcodes.isConfigured(),
    authenticated: dependencies.adminSessions.rendererStatus(event.sender.id) !== null,
    expiresAt: dependencies.adminSessions.rendererStatus(event.sender.id),
  }));
  register('admin:login', async (event, input) => {
    const key = `renderer:${event.sender.id}`;
    dependencies.adminSessions.assertLoginAllowed(key);
    const valid = await dependencies.passcodes.verify(input.passcode);
    dependencies.adminSessions.recordLoginResult(key, valid);
    if (!valid) throw new AppError('invalid_passcode', 'The passcode is incorrect.');
    const expiresAt = dependencies.adminSessions.authenticateRenderer(event.sender.id);
    return { configured: true, authenticated: true, expiresAt };
  });
  register('admin:logout', (event) => {
    dependencies.adminSessions.logoutRenderer(event.sender.id);
    return {};
  });
  register('admin:bootstrap-passcode', async (event, input) => {
    await dependencies.passcodes.bootstrap(input.passcode);
    const expiresAt = dependencies.adminSessions.authenticateRenderer(event.sender.id);
    return { configured: true, authenticated: true, expiresAt };
  });
  register('admin:change-passcode', async (event, input) => {
    requireAdmin(event);
    await dependencies.passcodes.change(input.currentPasscode, input.newPasscode);
    dependencies.adminSessions.clear();
    return {};
  });
  register('admin:get-settings', async (event) => {
    requireAdmin(event);
    return adminSettings(dependencies.repository, dependencies.frameService);
  });
  register('admin:save-settings', async (event, input) => {
    requireAdmin(event);
    if (input.lanEnabled) {
      assertPrivateIpv4(input.lanBindHost);
      if (!dependencies.repository.getSettings().lanTlsSecretRef) {
        throw new AppError(
          'lan_tls_required',
          'Choose a PFX certificate before enabling LAN access.',
        );
      }
    }
    dependencies.repository.updateSettings(input);
    dependencies.onNetworkSettingsChanged();
    return adminSettings(dependencies.repository, dependencies.frameService);
  });
  register('admin:list-frames', () => dependencies.frameService.getFrameSummaries());
  register('admin:add-frame', async (event) => {
    requireAdmin(event);
    const owner = BrowserWindow.fromWebContents(event.sender);
    const dialogOptions: OpenDialogOptions = {
      title: 'Choose a transparent PNG frame',
      properties: ['openFile'],
      filters: [{ name: 'Transparent PNG', extensions: ['png'] }],
    };
    const result = owner
      ? await dialog.showOpenDialog(owner, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions);
    const selected = result.filePaths[0];
    if (result.canceled || !selected) return null;
    const frame = await dependencies.frameService.importFrame(
      basename(selected, '.png'),
      await readFile(selected),
    );
    return dependencies.frameService.toSummary(frame);
  });
  register('admin:update-frame-layout', (event, input) => {
    requireAdmin(event);
    return dependencies.frameService.toSummary(
      dependencies.frameService.updateLayout(
        input.frameId,
        input.name,
        input.slots,
        input.expectedRevision,
      ),
    );
  });
  register('admin:delete-frame', (event, input) => {
    requireAdmin(event);
    return dependencies.frameService.deleteFrame(input.frameId);
  });
  register('admin:move-frame', (event, input) => {
    requireAdmin(event);
    return dependencies.frameService.moveFrame(input.frameId, input.direction);
  });
  register('admin:choose-lan-certificate', async (event, input) => {
    requireAdmin(event);
    const owner = BrowserWindow.fromWebContents(event.sender);
    const dialogOptions: OpenDialogOptions = {
      title: 'Choose the LAN HTTPS certificate',
      properties: ['openFile'],
      filters: [{ name: 'PKCS #12 certificate', extensions: ['pfx', 'p12'] }],
    };
    const result = owner
      ? await dialog.showOpenDialog(owner, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions);
    const selected = result.filePaths[0];
    if (result.canceled || !selected) return null;
    const certificate = dependencies.certificates.importPfx(
      await readFile(selected),
      input.passphrase,
    );
    dependencies.onNetworkSettingsChanged();
    return { message: `Certificate fingerprint ${certificate.fingerprint}` };
  });
  register('admin:list-upload-jobs', (event, input) => {
    requireAdmin(event);
    const cursor = input.cursor === null ? null : Number(input.cursor);
    if (cursor !== null && (!Number.isSafeInteger(cursor) || cursor < 0)) {
      throw new AppError('invalid_cursor', 'The upload-queue cursor is invalid.');
    }
    const items = dependencies.repository.listUploadJobs(input.limit, cursor).map(uploadSummary);
    return {
      items,
      nextCursor: items.length === input.limit ? String(items.at(-1)?.updatedAt) : null,
    };
  });
  register('admin:retry-upload', (event, input) => {
    requireAdmin(event);
    const job = dependencies.repository.retryUpload(input.uploadJobId);
    dependencies.uploadQueue.wake();
    return uploadSummary(job);
  });
  register('admin:get-health', async (event) => {
    requireAdmin(event);
    return dependencies.health.getHealth();
  });
  register('admin:restart-session', (event, input) => {
    requireAdmin(event);
    return dependencies.workflow.restartSession(input.sessionId);
  });
  register('admin:connect-cloud', async (event, input) => {
    requireAdmin(event);
    if (input.supabaseUrl && input.supabasePublishableKey) {
      dependencies.delivery.reconfigure({
        url: input.supabaseUrl,
        publishableKey: input.supabasePublishableKey,
      });
      dependencies.repository.setCloudSettings(
        input.supabaseUrl,
        input.supabasePublishableKey,
        Date.now(),
      );
    }
    await dependencies.delivery.connect(input.email, input.password);
    dependencies.uploadQueue.resumeAuthenticationPaused();
    return { message: 'The dedicated booth cloud account is connected.' };
  });

  const unsubscribe = dependencies.workflow.subscribe((snapshot) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(BOOTH_SNAPSHOT_EVENT, snapshot);
    }
  });
  return () => {
    unsubscribe();
    for (const channel of channels) ipcMain.removeHandler(channel);
  };
}

async function adminSettings(
  repository: LocalRepository,
  frames: FrameService,
): Promise<AdminSettings> {
  const settings = repository.getSettings();
  await frames.ensureDefaultFrames();
  const library = frames.getFrameSummaries();
  const activeFrame = library.find((frame) => frame.id === settings.activeFrameId) ?? library[0];
  if (!activeFrame) {
    throw new AppError('frame_missing', 'No photo frames are configured for this booth.');
  }
  return {
    googleFormsUrl: settings.googleFormsUrl,
    localRetentionDays: 60,
    cloudRetentionDays: 30,
    lan: {
      enabled: settings.lanEnabled,
      bindHost: settings.lanBindHost,
      port: settings.lanPort,
      tlsConfigured: settings.lanTlsSecretRef !== null,
      certificateFingerprint: settings.lanCertificateFingerprint,
    },
    activeFrame,
    frames: library,
    cameraAdapter: settings.cameraAdapter,
    cameraDeviceId: settings.cameraDeviceId,
    cameraResolution: settings.cameraResolution,
    supabaseUrl: settings.supabaseUrl,
    supabasePublishableKey: settings.supabasePublishableKey,
    revision: settings.revision,
  };
}

function uploadSummary(job: StoredUploadJob): UploadJobSummary {
  return {
    id: job.id,
    sessionId: job.sessionId,
    state: job.state,
    attemptCount: job.attemptCount,
    automaticRetryIndex: job.automaticRetryIndex,
    nextAttemptAt: job.nextAttemptAt,
    lastErrorCode: job.lastErrorCode,
    lastErrorMessage: job.lastErrorMessage,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

function assertTrustedSender(event: IpcMainInvokeEvent, expectedOrigin: string): void {
  assertTrustedIpcSender(
    event.senderFrame?.url ?? null,
    event.senderFrame !== null && event.senderFrame === event.sender.mainFrame,
    expectedOrigin,
  );
}

function rpcError(error: unknown): RpcError {
  if (error instanceof ZodError) {
    const issues = error.issues
      .map((i) => (i.path.length > 0 ? `${i.path.join('.')}: ${i.message}` : i.message))
      .join(', ');
    return {
      code: 'invalid_request',
      message: issues || 'The request is invalid.',
      retryable: false,
    };
  }
  const appError =
    error instanceof AppError
      ? error
      : new AppError('internal_error', 'Something went wrong. Please try again.');
  const code: RpcError['code'] =
    appError.code === 'unauthorized' || appError.code === 'invalid_passcode'
      ? 'unauthorized'
      : appError.code === 'forbidden'
        ? 'forbidden'
        : appError.code === 'rate_limited'
          ? 'rate_limited'
          : appError.code.includes('conflict') || appError.code.includes('active')
            ? 'conflict'
            : appError.code.includes('missing')
              ? 'not_found'
              : appError.code.includes('unavailable') || appError.code.includes('unsupported')
                ? 'unavailable'
                : 'internal_error';
  return { code, message: appError.safeMessage.slice(0, 300), retryable: appError.retryable };
}
