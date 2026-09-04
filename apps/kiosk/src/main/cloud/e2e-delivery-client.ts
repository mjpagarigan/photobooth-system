import { createHash } from 'node:crypto';

import type {
  AuthorizePhotoRepairRequest,
  AuthorizePhotoRepairResponse,
  ConfirmPhotoRepairRequest,
  ConfirmUploadResponse,
  CreateUploadRequest,
  CreateUploadResponse,
  ResumeUploadResponse,
  PhotoAvailability,
  GooglePhotosConfig,
  GooglePhotosStatus,
} from '@grace-booth/shared';

import { DeliveryFailure, type DeliveryClient } from './delivery-client.js';

const PHOTO_SESSION_ID = '11111111-1111-4111-8111-111111111111';
const PUBLIC_TOKEN = Buffer.alloc(32, 0x47).toString('base64url');

export class E2eDeliveryClient implements DeliveryClient {
  private uploadFailuresRemaining: number;

  constructor(
    uploadFailures: number,
    private readonly now: () => number,
    private readonly delays: { createMs: number; uploadMs: number; confirmMs: number },
  ) {
    this.uploadFailuresRemaining = uploadFailures;
  }

  isConfigured(): boolean {
    return true;
  }

  reconfigure(): void {
    void this.delays;
  }

  ensureAuthenticated(): Promise<void> {
    return Promise.resolve();
  }

  connect(): Promise<void> {
    return Promise.resolve();
  }

  async createUpload(request: CreateUploadRequest): Promise<CreateUploadResponse> {
    await delay(this.delays.createMs);
    return {
      photoSessionId: PHOTO_SESSION_ID,
      publicToken: PUBLIC_TOKEN,
      upload: {
        storagePath: `${PHOTO_SESSION_ID}/collage.jpg`,
        signedUploadToken: createHash('sha256').update(request.sha256).digest('base64url'),
        validForSeconds: 7_200,
      },
    };
  }

  async resumeUpload(): Promise<ResumeUploadResponse> {
    await delay(this.delays.createMs);
    return {
      photoSessionId: PHOTO_SESSION_ID,
      upload: {
        storagePath: `${PHOTO_SESSION_ID}/collage.jpg`,
        signedUploadToken: Buffer.alloc(32, 0x52).toString('base64url'),
        validForSeconds: 7_200,
      },
    };
  }

  async uploadSigned(): Promise<void> {
    await delay(this.delays.uploadMs);
    if (this.uploadFailuresRemaining > 0) {
      this.uploadFailuresRemaining -= 1;
      throw new DeliveryFailure(
        'transient',
        'e2e_injected_upload_failure',
        'The test upload failure was injected.',
      );
    }
  }

  async confirmUpload(): Promise<ConfirmUploadResponse> {
    await delay(this.delays.confirmMs);
    const readyAt = this.now();
    return {
      status: 'ready',
      readyAt: new Date(readyAt).toISOString(),
      expiresAt: new Date(readyAt + 30 * 24 * 60 * 60 * 1_000).toISOString(),
      publicPageOrigin: 'https://photos.e2e.invalid',
      publicPath: '/photo',
    };
  }

  checkPhotoAvailability(): Promise<PhotoAvailability> {
    return Promise.resolve('available');
  }

  authorizePhotoRepair(
    request: AuthorizePhotoRepairRequest,
  ): Promise<AuthorizePhotoRepairResponse> {
    return Promise.resolve({
      action: 'authorize',
      repairBatchId: '22222222-2222-4222-8222-222222222222',
      upload: {
        storagePath: `${request.photoSessionId}/collage.jpg`,
        uploadUrl: 'https://repair.e2e.invalid/photo.jpg',
        requiredHeaders: { 'content-type': 'image/jpeg', 'if-none-match': '*' },
        validForSeconds: 300,
      },
    });
  }

  confirmPhotoRepair(request: ConfirmPhotoRepairRequest): Promise<ConfirmUploadResponse> {
    void request;
    return this.confirmUpload();
  }

  getGooglePhotosStatus(): Promise<GooglePhotosStatus> {
    return Promise.resolve({
      config: {
        connectedEmail: 'booth-operator@example.com',
        albumId: 'e2e_album_123',
        albumTitle: 'E2E Photobooth Album',
        albumShareUrl: 'https://photos.app.goo.gl/e2e123',
        enabled: true,
      },
      stats: {
        syncedCount: 1,
        pendingCount: 0,
        failedCount: 0,
        lastSyncedAt: Date.now(),
      },
      hasRefreshToken: true,
      hasCredentials: true,
    });
  }

  saveGooglePhotosConfig(config: GooglePhotosConfig): Promise<void> {
    void config;
    return Promise.resolve();
  }

  createGooglePhotosAlbum(
    title: string,
  ): Promise<{ albumId: string; albumTitle: string; shareUrl: string }> {
    return Promise.resolve({
      albumId: 'e2e_created_album_123',
      albumTitle: title,
      shareUrl: `https://photos.app.goo.gl/${encodeURIComponent(title)}`,
    });
  }

  listGooglePhotosAlbums(): Promise<{ id: string; title: string; shareUrl?: string }[]> {
    return Promise.resolve([
      {
        id: 'e2e_album_1',
        title: 'Celebration 2026',
        shareUrl: 'https://photos.app.goo.gl/e2e1',
      },
    ]);
  }

  resolveGooglePhotosAlbum(
    shareUrl: string,
  ): Promise<{ albumId: string; albumTitle: string; shareUrl: string }> {
    return Promise.resolve({
      albumId: 'resolved_album_123',
      albumTitle: 'Resolved Event Album',
      shareUrl,
    });
  }

  syncGooglePhotosNow(): Promise<{ processed: number; succeeded: number; failed: number }> {
    return Promise.resolve({ processed: 1, succeeded: 1, failed: 0 });
  }

  testGooglePhotosUpload(): Promise<{ success: boolean; message: string }> {
    return Promise.resolve({
      success: true,
      message: 'E2E Google Photos test upload succeeded.',
    });
  }

  disconnectGooglePhotos(): Promise<void> {
    return Promise.resolve();
  }

  health(): Promise<{ healthy: boolean; code: string | null; message: string }> {
    return Promise.resolve({
      healthy: true,
      code: null,
      message: 'Deterministic E2E delivery is ready.',
    });
  }
}

function delay(milliseconds: number): Promise<void> {
  return milliseconds === 0
    ? Promise.resolve()
    : new Promise((resolve) => setTimeout(resolve, milliseconds));
}
