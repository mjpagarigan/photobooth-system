import type { LocalRepository, StoredAsset } from '../database/repositories.js';
import { AppError } from '../errors.js';
import { createThumbnailJpeg } from '../image/image-validation.js';
import type { ImageProcessor } from '../image/image-worker-client.js';
import type { PhotoVault } from './photo-vault.js';

export const MAX_THUMBNAIL_CACHE = 250;
export const THUMBNAIL_MAX_EDGE = 480;
export const THUMBNAIL_QUALITY = 82;
const MAX_CONCURRENT_THUMBNAILS = 4;

export class MediaService {
  private readonly thumbnailCache = new Map<string, Buffer>();
  private readonly inFlightThumbnails = new Map<string, Promise<Buffer>>();
  private activeThumbnailJobs = 0;
  private readonly thumbnailWaiters: (() => void)[] = [];

  constructor(
    private readonly repository: LocalRepository,
    private readonly vault: PhotoVault,
    private readonly imageProcessor?: Pick<ImageProcessor, 'createThumbnail'>,
  ) {}

  read(identifier: string): { bytes: Buffer; contentType: 'image/jpeg' | 'image/png' } {
    const asset = this.repository.getAsset(identifier);
    if (asset) {
      if (asset.cleanupState !== 'active') {
        this.thumbnailCache.delete(identifier);
        throw new AppError('media_missing', 'The requested image is unavailable.');
      }
      return { bytes: this.vault.read(asset.encryptedPath), contentType: 'image/jpeg' };
    }
    const frame = this.repository.getFrame(identifier);
    if (frame) return { bytes: this.vault.read(frame.encryptedPath), contentType: 'image/png' };
    throw new AppError('media_missing', 'The requested image is unavailable.');
  }

  async readThumbnail(identifier: string): Promise<{ bytes: Buffer; contentType: 'image/jpeg' }> {
    this.requireActiveCollage(identifier);

    const cached = this.thumbnailCache.get(identifier);
    if (cached) {
      this.thumbnailCache.delete(identifier);
      this.thumbnailCache.set(identifier, cached);
      return { bytes: cached, contentType: 'image/jpeg' };
    }

    let pending = this.inFlightThumbnails.get(identifier);
    if (!pending) {
      pending = this.generateThumbnail(identifier).finally(() => {
        if (this.inFlightThumbnails.get(identifier) === pending) {
          this.inFlightThumbnails.delete(identifier);
        }
      });
      this.inFlightThumbnails.set(identifier, pending);
    }

    const bytes = await pending;
    return { bytes, contentType: 'image/jpeg' };
  }

  private requireActiveCollage(identifier: string): StoredAsset {
    const asset = this.repository.getAsset(identifier);
    if (asset?.kind !== 'collage' || asset.cleanupState !== 'active') {
      this.thumbnailCache.delete(identifier);
      throw new AppError('media_missing', 'The requested image is unavailable.');
    }
    return asset;
  }

  private async generateThumbnail(identifier: string): Promise<Buffer> {
    return this.runWithThumbnailSlot(async () => {
      const asset = this.requireActiveCollage(identifier);
      const raw = this.vault.read(asset.encryptedPath);
      const thumbnail = this.imageProcessor
        ? await this.imageProcessor.createThumbnail(raw, THUMBNAIL_MAX_EDGE, THUMBNAIL_QUALITY)
        : await createThumbnailJpeg(raw, THUMBNAIL_MAX_EDGE, THUMBNAIL_QUALITY);

      this.requireActiveCollage(identifier);
      this.cacheThumbnail(identifier, thumbnail.bytes);
      return thumbnail.bytes;
    });
  }

  private cacheThumbnail(identifier: string, bytes: Buffer): void {
    this.thumbnailCache.delete(identifier);
    while (this.thumbnailCache.size >= MAX_THUMBNAIL_CACHE) {
      const oldestKey = this.thumbnailCache.keys().next().value;
      if (oldestKey === undefined) break;
      this.thumbnailCache.delete(oldestKey);
    }
    this.thumbnailCache.set(identifier, bytes);
  }

  private async runWithThumbnailSlot<T>(task: () => Promise<T>): Promise<T> {
    await this.acquireThumbnailSlot();
    try {
      return await task();
    } finally {
      this.releaseThumbnailSlot();
    }
  }

  private async acquireThumbnailSlot(): Promise<void> {
    if (this.activeThumbnailJobs < MAX_CONCURRENT_THUMBNAILS) {
      this.activeThumbnailJobs += 1;
      return;
    }
    await new Promise<void>((resolve) => {
      this.thumbnailWaiters.push(resolve);
    });
  }

  private releaseThumbnailSlot(): void {
    const next = this.thumbnailWaiters.shift();
    if (next) {
      next();
      return;
    }
    this.activeThumbnailJobs -= 1;
  }
}
