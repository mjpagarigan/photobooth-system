import { createHash, timingSafeEqual } from 'node:crypto';

import type {
  GalleryCloudRepairResult,
  GalleryItem,
  GalleryUploadStatus,
} from '@grace-booth/shared';

import { validateReadyReceipt } from '../cloud/ready-receipt.js';
import type { QrService } from '../cloud/qr-service.js';
import type { UploadQueue } from '../cloud/upload-queue.js';
import type { DeliveryClient } from '../cloud/delivery-client.js';
import type { LocalRepository, StoredSession } from '../database/repositories.js';
import type { ImageProcessor } from '../image/image-worker-client.js';
import type { PhotoVault } from '../storage/photo-vault.js';
import { AppError } from '../errors.js';

export type RecentGalleryDependencies = {
  repository: LocalRepository;
  vault: PhotoVault;
  uploadQueue: Pick<UploadQueue, 'readDeliverySecret'>;
  qrService: QrService;
  imageProcessor: ImageProcessor;
  delivery: Pick<DeliveryClient, 'checkPhotoAvailability'> &
    Partial<
      Pick<
        DeliveryClient,
        'authorizePhotoRepair' | 'uploadSigned' | 'confirmPhotoRepair'
      >
    >;
};

const PREVIEW_LONG_EDGE = 3600;

type SessionDelivery = {
  qrDataUrl: string | null;
  cloudExpiresAt: number | null;
  lanReceiptOnly: boolean;
  availability: 'uploaded' | 'unavailable' | 'verification-failed';
};

/**
 * Builds the guest/operator "Recent" gallery. Previews are read from immutable stored collage
 * assets and thumbnailed off the main thread by the shared image worker.
 */
export class RecentGalleryService {
  private readonly repairsInFlight = new Set<string>();

  constructor(private readonly dependencies: RecentGalleryDependencies) {}

  async getRecent(limit = 20): Promise<GalleryItem[]> {
    const sessions = this.dependencies.repository.listRecentSessionsWithCollage(limit);
    const items = await mapConcurrent(sessions, 4, (session) => this.buildItem(session));
    return items.filter((item): item is GalleryItem => item !== null);
  }

  async repairCloudPhoto(sessionId: string): Promise<GalleryCloudRepairResult> {
    if (this.repairsInFlight.has(sessionId)) {
      throw new AppError(
        'repair_conflict',
        'Cloud recovery is already running for this photo.',
        true,
      );
    }
    this.repairsInFlight.add(sessionId);
    try {
      const { repository, vault, uploadQueue, delivery } = this.dependencies;
      const session = repository.getSession(sessionId);
      const collageAssetId = session?.collageAssetId;
      const publicSecretRef = session?.publicSecretRef;
      if (!collageAssetId || !publicSecretRef) {
        return originalBoothRequired();
      }
      const collage = repository.getAsset(collageAssetId);
      if (collage?.kind !== 'collage' || collage.cleanupState !== 'active') {
        return originalBoothRequired();
      }

      let bytes: Buffer;
      try {
        bytes = vault.read(collage.encryptedPath);
      } catch {
        return originalBoothRequired();
      }
      const actualHash = createHash('sha256').update(bytes).digest('hex');
      if (
        bytes.byteLength !== collage.byteSize ||
        !/^[a-f0-9]{64}$/u.test(collage.sha256) ||
        !timingSafeEqual(Buffer.from(actualHash, 'hex'), Buffer.from(collage.sha256, 'hex'))
      ) {
        return originalBoothRequired();
      }

      let secret: ReturnType<RecentGalleryDependencies['uploadQueue']['readDeliverySecret']>;
      try {
        secret = uploadQueue.readDeliverySecret(publicSecretRef);
      } catch {
        return originalBoothRequired();
      }
      if (
        !secret.ready ||
        (session.cloudPhotoSessionId !== null &&
          secret.photoSessionId !== session.cloudPhotoSessionId)
      ) {
        return originalBoothRequired();
      }
      validateReadyReceipt(secret.photoSessionId, secret.publicToken, secret.ready);
      if (!delivery.authorizePhotoRepair || !delivery.uploadSigned || !delivery.confirmPhotoRepair) {
        throw new AppError(
          'repair_unavailable',
          'Cloud recovery is unavailable on this booth version.',
          true,
        );
      }
      const metadata = {
        byteSize: collage.byteSize,
        sha256: collage.sha256,
        width: collage.width,
        height: collage.height,
      };
      const authorization = await delivery.authorizePhotoRepair({
        action: 'authorize',
        photoSessionId: secret.photoSessionId,
        publicToken: secret.publicToken,
        metadata,
      });
      await delivery.uploadSigned(
        authorization.upload.storagePath,
        'r2_repair_presigned',
        bytes,
        authorization.upload.uploadUrl,
        authorization.upload.requiredHeaders,
      );
      await delivery.confirmPhotoRepair({
        action: 'confirm',
        photoSessionId: secret.photoSessionId,
        publicToken: secret.publicToken,
        repairBatchId: authorization.repairBatchId,
        metadata,
      });
      return {
        status: 'repaired',
        message: 'Cloud copy repaired. Recent Photos has been refreshed.',
      };
    } finally {
      this.repairsInFlight.delete(sessionId);
    }
  }

  private async buildItem(session: StoredSession): Promise<GalleryItem | null> {
    try {
      if (!session.collageAssetId) return null;
      const repository = this.dependencies.repository;
      const assets = repository.listAssets(session.id);
      const collageAsset = assets.find((asset) => asset.id === session.collageAssetId);
      if (!collageAsset) return null;

      const collageBytes = this.dependencies.vault.read(collageAsset.encryptedPath);
      const thumbnail = await this.dependencies.imageProcessor.createThumbnail(
        collageBytes,
        PREVIEW_LONG_EDGE,
      );

      const frame = session.selectedFrameId ? repository.getFrame(session.selectedFrameId) : null;
      const captures = assets.filter((asset) => asset.kind === 'capture');
      const job = repository.getUploadJobForSession(session.id);
      let delivery: SessionDelivery | null = null;
      try {
        delivery = await this.resolveDelivery(session);
      } catch {
        delivery = session.publicSecretRef
          ? {
              qrDataUrl: null,
              cloudExpiresAt: session.expiresAt,
              lanReceiptOnly: false,
              availability: 'verification-failed',
            }
          : null;
      }

      return {
        sessionId: session.id,
        previewDataUrl: `data:image/jpeg;base64,${thumbnail.bytes.toString('base64')}`,
        qrDataUrl: delivery?.qrDataUrl ?? null,
        metadata: {
          capturedAt: session.createdAt,
          photoCount: Math.min(3, captures.length),
          frameName: frame?.name ?? null,
          uploadStatus:
            job?.state === 'succeeded'
              ? delivery?.lanReceiptOnly
                ? 'local-receipt'
                : (delivery?.availability ?? 'verification-failed')
              : jobStatus(job?.state ?? 'queued'),
          cloudExpiresAt: delivery?.cloudExpiresAt ?? null,
        },
      };
    } catch {
      // A single unreadable session must not take down the whole gallery.
      return null;
    }
  }

  private async resolveDelivery(session: StoredSession): Promise<SessionDelivery> {
    const empty: SessionDelivery = {
      qrDataUrl: null,
      cloudExpiresAt: null,
      lanReceiptOnly: false,
      availability: 'verification-failed',
    };
    if (!session.publicSecretRef) return empty;
    const secret = this.dependencies.uploadQueue.readDeliverySecret(session.publicSecretRef);
    if (!secret.ready) return empty;
    const receipt = validateReadyReceipt(secret.photoSessionId, secret.publicToken, secret.ready);
    const expiresAtMs = Date.parse(receipt.expiresAt);
    const lanReceiptOnly = receipt.publicPageOrigin.startsWith('http://');
    if (!lanReceiptOnly) {
      const availability = await this.dependencies.delivery.checkPhotoAvailability(
        receipt.publicToken,
        receipt.publicPageOrigin,
      );
      if (availability !== 'available') {
        return {
          qrDataUrl: null,
          cloudExpiresAt: Number.isFinite(expiresAtMs) ? expiresAtMs : null,
          lanReceiptOnly: false,
          availability: availability === 'unavailable' ? 'unavailable' : 'verification-failed',
        };
      }
    }
    const rendered = await this.dependencies.qrService.render(receipt).catch(() => null);
    return {
      qrDataUrl: rendered?.imageDataUrl ?? null,
      cloudExpiresAt: Number.isFinite(expiresAtMs) ? expiresAtMs : null,
      // Offline receipts point at the LAN listener (http://), cloud receipts at HTTPS origins.
      lanReceiptOnly,
      availability: rendered ? 'uploaded' : 'verification-failed',
    };
  }
}

function jobStatus(state: UploadQueueJobState): GalleryUploadStatus {
  if (state === 'failed') return 'failed';
  return 'pending';
}

type UploadQueueJobState =
  | 'queued'
  | 'creating_upload'
  | 'uploading'
  | 'confirming'
  | 'retry_wait'
  | 'failed'
  | 'succeeded'
  | 'cancelled';

async function mapConcurrent<T, R>(
  values: readonly T[],
  limit: number,
  mapper: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  const queue = values.map((value, index) => ({ index, value }));
  const workers = Array.from({ length: Math.min(limit, values.length) }, async () => {
    for (;;) {
      const entry = queue.shift();
      if (!entry) return;
      results[entry.index] = await mapper(entry.value);
    }
  });
  await Promise.all(workers);
  return results;
}

function originalBoothRequired(): GalleryCloudRepairResult {
  return {
    status: 'original-booth-required',
    message: 'Recovery requires the original booth.',
  };
}
