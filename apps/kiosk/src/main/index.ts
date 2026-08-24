import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { CAMERA_FRAME_REQUEST_EVENT } from '@grace-booth/shared';
import { app, dialog } from 'electron';

import { AdminSessionService } from './auth/admin-sessions.js';
import { CloudSessionStore } from './auth/cloud-session-store.js';
import { LanCertificateService } from './auth/lan-certificate-service.js';
import { PasscodeService } from './auth/passcode-service.js';
import { E2eDeliveryClient } from './cloud/e2e-delivery-client.js';
import { QrService } from './cloud/qr-service.js';
import { SupabaseDeliveryClient, type DeliveryClient } from './cloud/delivery-client.js';
import { UploadQueue } from './cloud/upload-queue.js';
import { loadRuntimeConfig } from './config.js';
import { DynamicCameraAdapter } from './camera/dynamic-camera-adapter.js';
import { RendererFrameBroker } from './camera/renderer-frame-broker.js';
import { openBoothDatabase } from './database/database.js';
import { LocalRepository } from './database/repositories.js';
import { FrameService } from './frame/frame-service.js';
import { RecentGalleryService } from './gallery/recent-gallery-service.js';
import { HealthService } from './health-service.js';
import { WorkerImageProcessor } from './image/image-worker-client.js';
import { registerIpcHandlers } from './ipc/register-ipc.js';
import { createApplicationLogger } from './logging.js';
import { runNativeSelfTest } from './native-self-test.js';
import { installProtocolHandlers, registerPrivilegedSchemes } from './security/protocols.js';
import { createKioskWindow, getRendererTarget } from './security/window.js';
import { AdminServerManager } from './server/admin-server-manager.js';
import type { LocalAdminDependencies } from './server/local-admin-server.js';
import { OfflineDeliveryServer } from './server/offline-delivery-server.js';
import { electronSecretProtection } from './storage/electron-secret-protection.js';
import { MediaService } from './storage/media-service.js';
import { createAppPaths } from './storage/paths.js';
import { PhotoVault } from './storage/photo-vault.js';
import { RetentionService } from './storage/retention-service.js';
import { SecretStore } from './storage/secret-store.js';
import { BoothWorkflow } from './workflow/booth-workflow.js';

registerPrivilegedSchemes();

const hasInstanceLock = app.requestSingleInstanceLock();
if (!hasInstanceLock) app.quit();

void app
  .whenReady()
  .then(async () => {
    if (!hasInstanceLock) return;
    if (process.argv.includes('--native-self-test')) {
      try {
        const result = await runNativeSelfTest(new URL('./image-worker.js', import.meta.url));
        process.stdout.write(`${JSON.stringify(result)}\n`);
        app.exit(result.ok ? 0 : 1);
      } catch {
        process.stdout.write(`${JSON.stringify({ ok: false, code: 'native_self_test_failed' })}\n`);
        app.exit(1);
      }
      return;
    }
    await startApplication();
  })
  .catch((error: unknown) => {
    console.error('Fatal startup error:', error);
    dialog.showErrorBox(
      'Grace Booth could not start',
      'The booth could not start safely. No photos were deleted. Please contact the operator.',
    );
    app.exit(1);
  });

async function startApplication(): Promise<void> {
  app.setAppUserModelId('org.gracebooth.kiosk');
  if (!app.isPackaged) {
    const candidatePaths = [
      join(process.cwd(), '.env'),
      join(process.cwd(), '..', '.env'),
      join(process.cwd(), '..', '..', '.env'),
      join(app.getAppPath(), '.env'),
      join(app.getAppPath(), '..', '.env'),
      join(app.getAppPath(), '..', '..', '.env'),
    ];
    for (const envPath of candidatePaths) {
      try {
        if (existsSync(envPath)) {
          process.loadEnvFile(envPath);
        }
      } catch {
        // continue
      }
    }
  }
  const config = loadRuntimeConfig(process.env, app.isPackaged);
  const now = (): number => config.now();
  const appPath = app.getAppPath();
  const resourceRoot = app.isPackaged
    ? join(process.resourcesPath, 'resources')
    : join(appPath, 'resources');
  const migrationsDirectory = app.isPackaged
    ? join(process.resourcesPath, 'migrations')
    : join(appPath, 'migrations');
  const paths = createAppPaths(app.getPath('userData'));
  const logger = createApplicationLogger(paths.logs);
  const secrets = new SecretStore(paths.secrets, electronSecretProtection);
  secrets.assertAvailable();
  const vault = new PhotoVault(paths, secrets);
  const database = openBoothDatabase(paths.database, migrationsDirectory);
  const repository = new LocalRepository(database);
  const retention = new RetentionService(repository, vault, secrets, paths);
  const recovery = retention.recoverAfterRestart(now());
  const cleanup = retention.cleanupExpired(now());
  logger.info({ recovery, cleanup }, 'local recovery completed');

  const initialSettings = repository.getSettings();
  const initialCameraAdapter = initialSettings.cameraAdapter;
  const initialCameraDeviceId = initialSettings.cameraDeviceId;

  const cameraFrames = new RendererFrameBroker();
  let workflowInstance: BoothWorkflow | null = null;
  const camera = new DynamicCameraAdapter({
    mockOptions: {
      fixtureDirectory: join(resourceRoot, 'mock'),
      delayMs: config.e2e.cameraDelayMs,
      ...(config.e2e.captureFailShot === null
        ? {}
        : { failOnShotNumbers: new Set([config.e2e.captureFailShot]) }),
    },
    frameBroker: cameraFrames,
    initialAdapter: config.e2e.enabled ? config.cameraAdapter : initialCameraAdapter,
    initialDeviceId: initialCameraDeviceId,
    onAdapterChanged: (adapter) => {
      workflowInstance?.setCameraPreviewEnabled(
        adapter === 'webcam' || adapter === 'internal_webcam',
      );
    },
  });
  const imageProcessor = new WorkerImageProcessor(new URL('./image-worker.js', import.meta.url));
  const frameService = new FrameService(
    repository,
    vault,
    {
      option1: join(resourceRoot, 'frames', 'mat-frame.png'),
      option2: join(resourceRoot, 'frames', 'anniv-frame.png'),
    },
    imageProcessor,
  );
  const cloudSessions = new CloudSessionStore(secrets);
  const cloudOptions = {
    url: config.cloud.url ?? initialSettings.supabaseUrl,
    publishableKey: config.cloud.publishableKey ?? initialSettings.supabasePublishableKey,
  };
  const delivery: DeliveryClient = config.e2e.enabled
    ? new E2eDeliveryClient(config.e2e.uploadFailures, now, config.e2e.deliveryDelays)
    : new SupabaseDeliveryClient(cloudOptions, cloudSessions);
  const uploadQueue = new UploadQueue(repository, vault, secrets, delivery, now);
  const qrService = new QrService();
  const recentGallery = new RecentGalleryService({
    repository,
    vault,
    uploadQueue,
    qrService,
    imageProcessor,
  });
  const workflow = new BoothWorkflow(
    repository,
    vault,
    camera,
    frameService,
    imageProcessor,
    uploadQueue,
    qrService,
    {
      shotCountdownsMs: config.shotCountdownsMs,
      cameraPreviewEnabled:
        initialCameraAdapter === 'webcam' || initialCameraAdapter === 'internal_webcam',
      now,
    },
  );
  workflowInstance = workflow;
  const passcodes = new PasscodeService(repository);
  const adminSessions = new AdminSessionService();
  const certificates = new LanCertificateService(repository, secrets);
  const health = new HealthService(camera, delivery, repository, electronSecretProtection, now);
  const media = new MediaService(repository, vault);
  installProtocolHandlers(join(appPath, 'out', 'renderer'), media);

  let serverManager: AdminServerManager | null = null;
  const serverDependencies: LocalAdminDependencies = {
    passcodes,
    sessions: adminSessions,
    repository,
    frames: frameService,
    health,
    uploadQueue,
    onNetworkSettingsChanged: () => serverManager?.requestReconfigure(),
    listenerHealth: () =>
      serverManager?.getListenerHealth() ?? {
        loopback: 'unavailable',
        lan: 'disabled',
        code: null,
        message: 'The local admin listener is starting.',
      },
  };
  serverManager = new AdminServerManager(serverDependencies, repository, certificates);
  const offlineDeliveryServer = new OfflineDeliveryServer(
    repository,
    vault,
    secrets,
    initialSettings.lanPort || 4_310,
  );
  uploadQueue.setOfflineDeliveryServer(offlineDeliveryServer);
  await Promise.all([serverManager.start(), offlineDeliveryServer.start()]);
  await workflow.initialize();

  const target = getRendererTarget(app.isPackaged, process.env.ELECTRON_RENDERER_URL);
  const removeIpcHandlers = registerIpcHandlers({
    workflow,
    camera,
    passcodes,
    adminSessions,
    repository,
    frameService,
    certificates,
    health,
    delivery,
    uploadQueue,
    cameraFrames,
    recentGallery,
    rendererOrigin: target.origin,
    onNetworkSettingsChanged: () => serverManager.requestReconfigure(),
  });
  const { window } = await createKioskWindow(
    appPath,
    app.isPackaged,
    process.env.ELECTRON_RENDERER_URL,
  );
  cameraFrames.attach((request) => {
    if (!window.isDestroyed()) window.webContents.send(CAMERA_FRAME_REQUEST_EVENT, request);
  });
  window.on('closed', () => cameraFrames.detach());

  const dailyCleanup = setInterval(
    () => {
      const result = retention.cleanupExpired(now());
      logger.info({ result }, 'daily local cleanup completed');
    },
    24 * 60 * 60 * 1_000,
  );
  dailyCleanup.unref();

  let shutdownStarted = false;
  let shutdownComplete = false;
  app.on('before-quit', (event) => {
    if (shutdownComplete) return;
    event.preventDefault();
    if (shutdownStarted) return;
    shutdownStarted = true;
    clearInterval(dailyCleanup);
    removeIpcHandlers();
    void Promise.allSettled([
      workflow.close(),
      serverManager.close(),
      offlineDeliveryServer.close(),
    ]).then(() => {
      database.close();
      shutdownComplete = true;
      app.quit();
    });
  });
  app.on('second-instance', () => {
    if (window.isMinimized()) window.restore();
    window.focus();
  });
  app.on('window-all-closed', () => app.quit());
}
