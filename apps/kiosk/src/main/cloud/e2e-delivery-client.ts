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
