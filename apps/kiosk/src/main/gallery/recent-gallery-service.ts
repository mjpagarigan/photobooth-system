import { createHash, timingSafeEqual } from 'node:crypto';

import {
  MAX_FRAME_SLOTS,
  isPrintableFrameSize,
  type GalleryCloudRepairResult,
  type GalleryItem,
  type GalleryUploadStatus,
  type PhotoAvailability,
} from '@grace-booth/shared';

import { validateReadyReceipt, type ReadyReceipt } from '../cloud/ready-receipt.js';
import type { QrService } from '../cloud/qr-service.js';
import type { UploadQueue } from '../cloud/upload-queue.js';
import type { DeliveryClient } from '../cloud/delivery-client.js';
import type { LocalRepository, StoredFrame, StoredSession } from '../database/repositories.js';
import type { PhotoVault } from '../storage/photo-vault.js';
import { AppError } from '../errors.js';

export type RecentGalleryDependencies = {
  repository: LocalRepository;
  vault: PhotoVault;
  uploadQueue: Pick<UploadQueue, 'readDeliverySecret'>;
  qrService: QrService;
  delivery: Pick<DeliveryClient, 'checkPhotoAvailability'> &
    Partial<Pick<DeliveryClient, 'authorizePhotoRepair' | 'uploadSigned' | 'confirmPhotoRepair'>>;
  now?: () => number;
};

const MAX_CACHED_QRS = 300;
const MAX_AVAILABILITY_CACHE = 500;
const AVAILABILITY_TTL_MS = 5 * 60 * 1_000;
const OFFLINE_COOLDOWN_MS = 15_000;
const OFFLINE_BREAKER_THRESHOLD = 4;

type SessionDelivery = {
  qrDataUrl: string | null;
  cloudExpiresAt: number | null;
  lanReceiptOnly: boolean;
  availability: 'uploaded' | 'unavailable' | 'verification-failed';
};

type ProbeState = {
  consecutiveFailures: number;
  breakerTripped: boolean;
};

export function localDayWindow(nowMs: number): { startMs: number; endMs: number } {
  if (!Number.isFinite(nowMs)) {
    throw new AppError('invalid_day_window', 'The requested date window is invalid.');
  }
  const date = new Date(nowMs);
  const year = date.getFullYear();
  const month = date.getMonth();
  const day = date.getDate();
  if (!Number.isFinite(year)) {
    throw new AppError('invalid_day_window', 'The requested date window is invalid.');
  }
  const start = new Date(0);
  start.setFullYear(year, month, day);
  start.setHours(0, 0, 0, 0);
  const end = new Date(0);
  end.setFullYear(year, month, day + 1);
  end.setHours(0, 0, 0, 0);
  const startMs = start.getTime();
  const endMs = end.getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    throw new AppError('invalid_day_window', 'The requested date window is invalid.');
  }
  return { startMs, endMs };
}

export class RecentGalleryService {
  private readonly repairsInFlight = new Set<string>();
  private readonly now: () => number;
  private readonly qrCache = new BoundedLruMap<string>(MAX_CACHED_QRS);
  private readonly availabilityCache = new BoundedLruMap<{ checkedAt: number }>(
    MAX_AVAILABILITY_CACHE,
  );
  private cachedDayStartMs: number | null = null;
  private offlineUntilMs = 0;

  constructor(private readonly dependencies: RecentGalleryDependencies) {
    this.now = dependencies.now ?? (() => Date.now());
  }

  async getRecent(options: { refresh?: boolean | undefined } = {}): Promise<GalleryItem[]> {
    const refresh = options.refresh === true;
    const { startMs, endMs } = localDayWindow(this.now());
    if (this.cachedDayStartMs !== startMs) {
      this.cachedDayStartMs = startMs;
      this.qrCache.clear();
      this.availabilityCache.clear();
      this.offlineUntilMs = 0;
    }
    if (refresh) {
      this.offlineUntilMs = 0;
    }

    const sessions = this.dependencies.repository.listSessionsWithCollageBetween(startMs, endMs);
    if (sessions.length === 0) return [];

    const frameCache = new Map<string, StoredFrame | null>();
    const probeState: ProbeState = { consecutiveFailures: 0, breakerTripped: false };
    const items = await mapConcurrent(sessions, 4, (session) =>
      this.buildItem(session, frameCache, probeState, refresh, startMs),
    );
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
      if (
        !delivery.authorizePhotoRepair ||
        !delivery.uploadSigned ||
        !delivery.confirmPhotoRepair
      ) {
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
      this.invalidateSessionCaches(sessionId);
      this.offlineUntilMs = 0;
      return {
        status: 'repaired',
        message: 'Cloud copy repaired. Recent Photos has been refreshed.',
      };
    } finally {
      this.repairsInFlight.delete(sessionId);
    }
  }

  private invalidateSessionCaches(sessionId: string): void {
    const prefix = `${sessionId}:`;
    this.availabilityCache.deleteByPrefix(prefix);
    this.qrCache.deleteByPrefix(prefix);
  }

  private async buildItem(
    session: StoredSession,
    frameCache: Map<string, StoredFrame | null>,
    probeState: ProbeState,
    refresh: boolean,
    dayStartMs: number,
  ): Promise<GalleryItem | null> {
    try {
      if (!session.collageAssetId) return null;
      const repository = this.dependencies.repository;
      const assets = repository.listCurrentAssets(session.id);
      const collageAsset = assets.find((asset) => asset.id === session.collageAssetId);
      if (!collageAsset) return null;

      const frame = resolveFrame(repository, session.selectedFrameId, frameCache);
      const captures = assets.filter((asset) => asset.kind === 'capture');
      const job = repository.getUploadJobForSession(session.id);
      let delivery: SessionDelivery | null = null;
      try {
        delivery = await this.resolveDelivery(session, probeState, refresh, dayStartMs);
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
        previewUrl: `grace-booth-media://thumb/${collageAsset.id}`,
        detailUrl: `grace-booth-media://asset/${collageAsset.id}`,
        qrDataUrl: delivery?.qrDataUrl ?? null,
        metadata: {
          capturedAt: session.createdAt,
          photoCount: Math.min(MAX_FRAME_SLOTS, captures.length),
          frameName: frame?.name ?? null,
          uploadStatus:
            job?.state === 'succeeded'
              ? delivery?.lanReceiptOnly
                ? 'local-receipt'
                : (delivery?.availability ?? 'verification-failed')
              : jobStatus(job?.state ?? 'queued'),
          cloudExpiresAt: delivery?.cloudExpiresAt ?? null,
          printable: isPrintableFrameSize(collageAsset.width, collageAsset.height),
        },
      };
    } catch {
      // A single unreadable session must not take down the whole gallery.
      return null;
    }
  }

  private async resolveDelivery(
    session: StoredSession,
    probeState: ProbeState,
    refresh: boolean,
    dayStartMs: number,
  ): Promise<SessionDelivery> {
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
    const cloudExpiresAt = Number.isFinite(expiresAtMs) ? expiresAtMs : null;
    // Offline receipts point at the LAN listener (http://), cloud receipts at HTTPS origins.
    const lanReceiptOnly = receipt.publicPageOrigin.startsWith('http://');
    if (!lanReceiptOnly) {
      const availabilityKey = `${session.id}:${session.publicSecretRef}`;
      const availability = await this.resolveCloudAvailability(
        session.id,
        availabilityKey,
        receipt,
        probeState,
        refresh,
        dayStartMs,
      );
      if (availability !== 'available') {
        return {
          qrDataUrl: null,
          cloudExpiresAt,
          lanReceiptOnly: false,
          availability,
        };
      }
    }

    const qrKey = `${session.id}:${session.publicSecretRef}:${receipt.publicPageOrigin}:${receipt.expiresAt}`;
    let qrDataUrl = this.qrCache.get(qrKey) ?? null;
    if (!qrDataUrl) {
      const rendered = await this.dependencies.qrService.render(receipt).catch(() => null);
      if (rendered) {
        qrDataUrl = rendered.imageDataUrl;
        if (this.cachedDayStartMs === dayStartMs) {
          this.qrCache.set(qrKey, qrDataUrl);
        }
      }
    }
    return {
      qrDataUrl,
      cloudExpiresAt,
      lanReceiptOnly,
      availability: qrDataUrl ? 'uploaded' : 'verification-failed',
    };
  }

  private async resolveCloudAvailability(
    sessionId: string,
    availabilityKey: string,
    receipt: ReadyReceipt,
    probeState: ProbeState,
    refresh: boolean,
    dayStartMs: number,
  ): Promise<PhotoAvailability> {
    if (!refresh) {
      const cached = this.availabilityCache.get(availabilityKey);
      if (cached !== undefined) {
        const ageMs = this.now() - cached.checkedAt;
        if (ageMs >= 0 && ageMs < AVAILABILITY_TTL_MS) {
          return 'available';
        }
        this.availabilityCache.delete(availabilityKey);
      }
      if (probeState.breakerTripped || this.now() < this.offlineUntilMs) {
        return 'verification-failed';
      }
    }

    let availability: PhotoAvailability;
    try {
      availability = await this.dependencies.delivery.checkPhotoAvailability(
        receipt.publicToken,
        receipt.publicPageOrigin,
      );
    } catch {
      availability = 'verification-failed';
    }

    switch (availability) {
      case 'available':
        probeState.consecutiveFailures = 0;
        if (this.cachedDayStartMs === dayStartMs) {
          this.availabilityCache.set(availabilityKey, { checkedAt: this.now() });
        }
        return 'available';
      case 'unavailable':
        probeState.consecutiveFailures = 0;
        this.availabilityCache.delete(availabilityKey);
        this.qrCache.deleteByPrefix(`${sessionId}:`);
        return 'unavailable';
      case 'verification-failed':
        this.availabilityCache.delete(availabilityKey);
        probeState.consecutiveFailures += 1;
        if (probeState.consecutiveFailures >= OFFLINE_BREAKER_THRESHOLD) {
          probeState.breakerTripped = true;
          if (this.cachedDayStartMs === dayStartMs) {
            this.offlineUntilMs = this.now() + OFFLINE_COOLDOWN_MS;
          }
        }
        return 'verification-failed';
      default: {
        const _exhaustive: never = availability;
        return _exhaustive;
      }
    }
  }
}

class BoundedLruMap<V> {
  private readonly entries = new Map<string, V>();

  constructor(private readonly maxEntries: number) {}

  get(key: string): V | undefined {
    const value = this.entries.get(key);
    if (value === undefined) return undefined;
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  set(key: string, value: V): void {
    if (this.maxEntries <= 0) return;
    this.entries.delete(key);
    while (this.entries.size >= this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey === undefined) break;
      this.entries.delete(oldestKey);
    }
    this.entries.set(key, value);
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  deleteByPrefix(prefix: string): void {
    for (const key of this.entries.keys()) {
      if (key.startsWith(prefix)) {
        this.entries.delete(key);
      }
    }
  }

  clear(): void {
    this.entries.clear();
  }
}

function resolveFrame(
  repository: LocalRepository,
  frameId: string | null,
  cache: Map<string, StoredFrame | null>,
): StoredFrame | null {
  if (!frameId) return null;
  if (cache.has(frameId)) {
    return cache.get(frameId) ?? null;
  }
  const frame = repository.getFrame(frameId);
  cache.set(frameId, frame);
  return frame;
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
