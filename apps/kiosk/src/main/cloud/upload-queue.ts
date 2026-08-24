import { randomBytes, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';

import type { ConfirmUploadResponse } from '@grace-booth/shared';
import {
  ConfirmUploadResponseSchema,
  CreateUploadRequestSchema,
  PublicTokenSchema as TokenSchema,
} from '@grace-booth/shared';

import type { LocalRepository, StoredUploadJob } from '../database/repositories.js';
import { AppError, toSafeError } from '../errors.js';
import type { PhotoVault } from '../storage/photo-vault.js';
import type { SecretStore } from '../storage/secret-store.js';
import { DeliveryFailure, type DeliveryClient } from './delivery-client.js';
import { confirmationFromReadyReceipt, validateReadyReceipt } from './ready-receipt.js';
import type { OfflineDeliveryServer } from '../server/offline-delivery-server.js';
import { getLocalIpAddress } from '../server/lan-ip.js';

const RETRY_DELAYS_MS = [1_000, 3_000, 8_000] as const;
const MAX_TIMER_MS = 30_000;

export type PublicDeliverySecret = {
  version: 1;
  photoSessionId: string;
  publicToken: string;
  ready: ConfirmUploadResponse | null;
};

export class UploadQueue extends EventEmitter {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopped = true;
  private readonly leaseOwner = randomUUID();
  private offlineDeliveryServer: OfflineDeliveryServer | null = null;

  constructor(
    private readonly repository: LocalRepository,
    private readonly vault: PhotoVault,
    private readonly secrets: SecretStore,
    private readonly delivery: DeliveryClient,
    private readonly now: () => number = Date.now,
  ) {
    super();
  }

  setOfflineDeliveryServer(server: OfflineDeliveryServer | null): void {
    this.offlineDeliveryServer = server;
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.repository.recoverUploadLeases(this.leaseOwner, this.now());
    this.schedule(0);
  }

  wake(): void {
    if (this.stopped) return;
    this.schedule(0);
  }

  resumeAuthenticationPaused(): void {
    this.repository.resumeAuthenticationPausedUploads(this.now());
    this.wake();
  }

  completeOffline(sessionId: string): Promise<void> {
    const job = this.repository.getUploadJobForSession(sessionId);
    if (!job) {
      throw new AppError('upload_job_missing', 'The upload job could not be found.');
    }
    const session = this.repository.requireSession(sessionId);
    if (session.state !== 'uploading') {
      this.repository.transitionSession(session.id, [session.state], 'uploading', {}, this.now());
    }
    this.generateLocalReceipt(job);
    return Promise.resolve();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  async processOneNow(): Promise<boolean> {
    if (this.running) return false;
    this.running = true;
    try {
      const job = this.repository.claimNextDueUpload(this.leaseOwner, this.now());
      if (!job) return false;
      this.emit('uploading', job.sessionId);
      await this.processJob(job);
      return true;
    } finally {
      this.running = false;
    }
  }

  readDeliverySecret(reference: string): PublicDeliverySecret {
    const raw = this.secrets.getJson(reference);
    if (
      !raw ||
      typeof raw !== 'object' ||
      (raw as Record<string, unknown>).version !== 1 ||
      typeof (raw as Record<string, unknown>).photoSessionId !== 'string' ||
      !TokenSchema.safeParse((raw as Record<string, unknown>).publicToken).success
    ) {
      throw new AppError('delivery_secret_invalid', 'The photo delivery record is invalid.');
    }
    const value = raw as Record<string, unknown>;
    return {
      version: 1,
      photoSessionId: String(value.photoSessionId),
      publicToken: TokenSchema.parse(value.publicToken),
      ready: value.ready === null ? null : ConfirmUploadResponseSchema.parse(value.ready),
    };
  }

  private schedule(delayMs: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.tick(), delayMs);
  }

  private async tick(): Promise<void> {
    if (this.stopped) return;
    try {
      while (await this.processOneNow()) {
        if (this.shouldStop()) return;
      }
    } finally {
      if (!this.shouldStop()) {
        const dueAt = this.repository.getNextUploadDueAt();
        const delay =
          dueAt === null ? MAX_TIMER_MS : Math.max(0, Math.min(MAX_TIMER_MS, dueAt - this.now()));
        this.schedule(delay);
      }
    }
  }

  private generateLocalReceipt(job: StoredUploadJob): void {
    const session = this.repository.requireSession(job.sessionId);
    if (!session.collageAssetId) {
      throw new AppError('collage_missing', 'The local collage is missing.');
    }
    const asset = this.repository.getAsset(session.collageAssetId);
    if (asset?.kind !== 'collage') {
      throw new AppError('collage_missing', 'The local collage is missing.');
    }

    const localPhotoSessionId = session.cloudPhotoSessionId ?? session.id;
    const token = randomBytes(32).toString('base64url');
    const readyAtDate = new Date(this.now());
    const expiresAtDate = new Date(this.now() + 30 * 24 * 60 * 60 * 1_000);

    const settings = this.repository.getSettings();
    const lanIp = settings.lanEnabled ? settings.lanBindHost : getLocalIpAddress();
    const lanPort = settings.lanPort || 4_310;
    const publicPageOrigin = `http://${lanIp}:${lanPort}`;

    const confirmed: ConfirmUploadResponse = {
      status: 'ready',
      readyAt: readyAtDate.toISOString(),
      expiresAt: expiresAtDate.toISOString(),
      publicPageOrigin,
      publicPath: '/photo',
    };

    const deliverySecret: PublicDeliverySecret = {
      version: 1,
      photoSessionId: localPhotoSessionId,
      publicToken: token,
      ready: confirmed,
    };

    let secretRef = session.publicSecretRef;
    if (!secretRef) {
      secretRef = this.secrets.writeNamedJson(`public-delivery-${session.id}`, deliverySecret);
      try {
        this.repository.attachCloudUpload(job.sessionId, localPhotoSessionId, secretRef);
      } catch (error) {
        this.secrets.delete(secretRef);
        throw error;
      }
    } else {
      this.secrets.replaceJson(secretRef, deliverySecret);
    }
    this.offlineDeliveryServer?.registerToken(token, session.id, asset.id);

    this.repository.markUploadReady(job.id, {
      cloudPhotoSessionId: localPhotoSessionId,
      publicSecretRef: secretRef,
      readyAt: readyAtDate.getTime(),
      expiresAt: expiresAtDate.getTime(),
    });
    this.emit('ready', job.sessionId);
  }

  private async processJob(job: StoredUploadJob): Promise<void> {
    let attemptStarted = false;
    const continuingAfterCapabilityExpiry = job.lastErrorCode === 'signed_upload_expired';
    try {
      if (!this.delivery.isConfigured()) {
        this.generateLocalReceipt(job);
        return;
      }
      await this.delivery.ensureAuthenticated();
      if (continuingAfterCapabilityExpiry) {
        this.repository.continueUploadAttempt(job.id, this.leaseOwner, this.now());
      } else {
        this.repository.beginUploadAttempt(job.id, this.leaseOwner, this.now());
        attemptStarted = true;
      }
      const session = this.repository.requireSession(job.sessionId);
      if (!session.collageAssetId)
        throw new AppError('collage_missing', 'The local collage is missing.');
      const asset = this.repository.getAsset(session.collageAssetId);
      if (asset?.kind !== 'collage') {
        throw new AppError('collage_missing', 'The local collage is missing.');
      }
      const bytes = this.vault.read(asset.encryptedPath);

      let remotePhotoSessionId = session.cloudPhotoSessionId;
      let secretRef = session.publicSecretRef;
      let deliverySecret: PublicDeliverySecret;
      let upload: {
        storagePath: string;
        signedUploadToken: string;
        uploadUrl?: string | undefined;
      };

      if (!remotePhotoSessionId || !secretRef) {
        const settings = this.repository.getSettings();
        const created = await this.delivery.createUpload(
          CreateUploadRequestSchema.parse({
            action: 'create',
            clientSessionId: session.id,
            contentType: 'image/jpeg',
            byteSize: asset.byteSize,
            sha256: asset.sha256,
            width: asset.width,
            height: asset.height,
            googleFormsUrl: settings.googleFormsUrl,
            capturedAt: new Date(session.createdAt).toISOString(),
          }),
        );
        deliverySecret = {
          version: 1,
          photoSessionId: created.photoSessionId,
          publicToken: created.publicToken,
          ready: null,
        };
        secretRef = this.secrets.writeNamedJson(`public-delivery-${session.id}`, deliverySecret);
        remotePhotoSessionId = created.photoSessionId;
        try {
          this.repository.attachCloudUpload(job.sessionId, remotePhotoSessionId, secretRef);
        } catch (error) {
          this.secrets.delete(secretRef);
          throw error;
        }
        upload = created.upload;
      } else {
        deliverySecret = this.readDeliverySecret(secretRef);
        const resumed = await this.delivery.resumeUpload({
          action: 'resume',
          photoSessionId: remotePhotoSessionId,
        });
        upload = resumed.upload;
      }

      this.repository.updateUploadJob(job.id, 'uploading');
      await this.delivery.uploadSigned(
        upload.storagePath,
        upload.signedUploadToken,
        bytes,
        upload.uploadUrl,
      );
      this.repository.updateUploadJob(job.id, 'confirming');
      const confirmed = await this.delivery.confirmUpload({
        photoSessionId: remotePhotoSessionId,
        publicToken: deliverySecret.publicToken,
      });
      let resolvedConfirmation = confirmed;
      try {
        const parsedUrl = new URL(confirmed.publicPageOrigin);
        if (parsedUrl.hostname === '127.0.0.1' || parsedUrl.hostname === 'localhost') {
          const settings = this.repository.getSettings();
          const lanIp = settings.lanEnabled ? settings.lanBindHost : getLocalIpAddress();
          const lanPort = settings.lanPort || 4_310;
          resolvedConfirmation = {
            ...confirmed,
            publicPageOrigin: `http://${lanIp}:${lanPort}`,
          };
        }
      } catch {
        // continue
      }
      this.offlineDeliveryServer?.registerToken(deliverySecret.publicToken, session.id, asset.id);
      const readyReceipt = validateReadyReceipt(
        remotePhotoSessionId,
        deliverySecret.publicToken,
        resolvedConfirmation,
      );
      this.secrets.replaceJson(secretRef, {
        ...deliverySecret,
        ready: confirmationFromReadyReceipt(readyReceipt),
      });
      this.repository.markUploadReady(job.id, {
        cloudPhotoSessionId: remotePhotoSessionId,
        publicSecretRef: secretRef,
        readyAt: Date.parse(confirmed.readyAt),
        expiresAt: Date.parse(confirmed.expiresAt),
      });
      this.emit('ready', job.sessionId);
    } catch (error) {
      if (error instanceof DeliveryFailure && error.code === 'cloud_unconfigured') {
        this.generateLocalReceipt(job);
        return;
      }
      const safe = toSafeError(error);
      if (error instanceof DeliveryFailure && error.kind === 'auth') {
        this.repository.requeueUploadWithoutFailure(
          job.id,
          this.leaseOwner,
          attemptStarted,
          this.now() + MAX_TIMER_MS,
          continuingAfterCapabilityExpiry ? 'signed_upload_expired' : safe.code.slice(0, 80),
          continuingAfterCapabilityExpiry
            ? 'The upload authorization expired and will be renewed.'
            : safe.safeMessage.slice(0, 300),
          this.now(),
        );
        this.emit('auth-required', job.sessionId);
        return;
      }
      if (
        error instanceof DeliveryFailure &&
        error.kind === 'signed_capability_expired' &&
        !continuingAfterCapabilityExpiry
      ) {
        this.repository.requeueAfterCapabilityExpiry(job.id, this.leaseOwner, this.now());
        this.emit('retry', job.sessionId);
        return;
      }
      const current = this.repository.requireUploadJob(job.id);
      const retryIndex = current.automaticRetryIndex;
      const retryable =
        error instanceof DeliveryFailure
          ? error.kind === 'transient' || error.kind === 'signed_capability_expired'
          : safe.retryable;
      const delay = retryable ? RETRY_DELAYS_MS[retryIndex] : undefined;
      const retryAt = delay === undefined ? null : this.now() + delay;
      const repeatedCapabilityExpiry =
        error instanceof DeliveryFailure &&
        error.kind === 'signed_capability_expired' &&
        continuingAfterCapabilityExpiry;
      this.repository.markUploadFailure(
        job.id,
        {
          retryAt,
          retryIndex: retryAt === null ? retryIndex : retryIndex + 1,
          errorCode: repeatedCapabilityExpiry
            ? 'signed_upload_expired_repeated'
            : safe.code.slice(0, 80),
          errorMessage: safe.safeMessage.slice(0, 300),
        },
        this.now(),
      );
      this.emit(retryAt === null ? 'failed' : 'retry', job.sessionId);
    }
  }

  private shouldStop(): boolean {
    return this.stopped;
  }
}
