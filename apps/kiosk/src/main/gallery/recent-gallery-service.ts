import type { GalleryItem, GalleryUploadStatus } from '@grace-booth/shared';

import { validateReadyReceipt } from '../cloud/ready-receipt.js';
import type { QrService } from '../cloud/qr-service.js';
import type { UploadQueue } from '../cloud/upload-queue.js';
import type { LocalRepository, StoredSession } from '../database/repositories.js';
import type { ImageProcessor } from '../image/image-worker-client.js';
import type { PhotoVault } from '../storage/photo-vault.js';

export type RecentGalleryDependencies = {
  repository: LocalRepository;
  vault: PhotoVault;
  uploadQueue: Pick<UploadQueue, 'readDeliverySecret'>;
  qrService: QrService;
  imageProcessor: ImageProcessor;
};

const PREVIEW_LONG_EDGE = 360;

type SessionDelivery = {
  qrDataUrl: string | null;
  cloudExpiresAt: number | null;
  lanReceiptOnly: boolean;
};

/**
 * Builds the guest/operator "Recent" gallery. Previews are read from immutable stored collage
 * assets and thumbnailed off the main thread by the shared image worker.
 */
export class RecentGalleryService {
  constructor(private readonly dependencies: RecentGalleryDependencies) {}

  async getRecent(limit = 20): Promise<GalleryItem[]> {
    const sessions = this.dependencies.repository.listRecentSessionsWithCollage(limit);
    const items = await Promise.all(sessions.map((session) => this.buildItem(session)));
    return items.filter((item): item is GalleryItem => item !== null);
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
        delivery = null;
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
                : 'uploaded'
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
    };
    if (!session.publicSecretRef) return empty;
    const secret = this.dependencies.uploadQueue.readDeliverySecret(session.publicSecretRef);
    if (!secret.ready) return empty;
    const receipt = validateReadyReceipt(secret.photoSessionId, secret.publicToken, secret.ready);
    const rendered = await this.dependencies.qrService.render(receipt).catch(() => null);
    const expiresAtMs = Date.parse(receipt.expiresAt);
    return {
      qrDataUrl: rendered?.imageDataUrl ?? null,
      cloudExpiresAt: Number.isFinite(expiresAtMs) ? expiresAtMs : null,
      // Offline receipts point at the LAN listener (http://), cloud receipts at HTTPS origins.
      lanReceiptOnly: receipt.publicPageOrigin.startsWith('http://'),
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
