import { randomUUID } from 'node:crypto';

import type {
  AuthorizePhotoRepairResponse,
  ConfirmUploadResponse,
  CreateUploadResponse,
  ResumeUploadResponse,
  PhotoAvailability,
} from '@grace-booth/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  classifySignedUploadFailure,
  DeliveryFailure,
  type DeliveryClient,
} from '../../src/main/cloud/delivery-client.js';
import { UploadQueue } from '../../src/main/cloud/upload-queue.js';
import type { StoredUploadJob } from '../../src/main/database/repositories.js';
import { createTestStore, type TestStore } from './helpers.js';

const PUBLIC_TOKEN = Buffer.alloc(32, 0x41).toString('base64url');

let store: TestStore | null = null;
let queue: UploadQueue | null = null;
afterEach(() => {
  queue?.stop();
  queue = null;
  store?.close();
  store = null;
  vi.useRealTimers();
});

describe('persistent upload queue', () => {
  it('runs one initial attempt plus exact 1s/3s/8s retries', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    store = createTestStore();
    const job = createQueuedSession(store, Date.now());
    const delivery = new TransientDelivery(3);
    queue = new UploadQueue(store.repository, store.vault, store.secrets, delivery, Date.now);
    queue.start();

    await vi.advanceTimersByTimeAsync(0);
    expect(delivery.uploadTimes).toEqual([1_000_000]);
    await vi.advanceTimersByTimeAsync(999);
    expect(delivery.uploadTimes).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(delivery.uploadTimes).toEqual([1_000_000, 1_001_000]);
    await vi.advanceTimersByTimeAsync(2_999);
    expect(delivery.uploadTimes).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(delivery.uploadTimes).toEqual([1_000_000, 1_001_000, 1_004_000]);
    await vi.advanceTimersByTimeAsync(7_999);
    expect(delivery.uploadTimes).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(delivery.uploadTimes).toEqual([1_000_000, 1_001_000, 1_004_000, 1_012_000]);

    const completed = store.repository.requireUploadJob(job.id);
    expect(completed.state).toBe('succeeded');
    expect(completed.attemptCount).toBe(4);
    expect(completed.lifetimeFailureCount).toBe(3);
    expect(store.repository.requireSession(job.sessionId).state).toBe('ready');
  });

  it('treats a permanent contract rejection as an immediate operator failure', async () => {
    store = createTestStore();
    const job = createQueuedSession(store, Date.now());
    const delivery = new TransientDelivery(0);
    delivery.permanent = true;
    queue = new UploadQueue(store.repository, store.vault, store.secrets, delivery);
    expect(await queue.processOneNow()).toBe(true);
    const failed = store.repository.requireUploadJob(job.id);
    expect(failed.state).toBe('failed');
    expect(failed.attemptCount).toBe(1);
    expect(store.repository.requireSession(job.sessionId).state).toBe('upload_failed');
  });

  it('classifies generic Storage 400 as permanent rather than renewable capability auth', () => {
    expect(classifySignedUploadFailure({ status: 400, code: 'InvalidRequest' })).toBe('permanent');
    expect(classifySignedUploadFailure({ status: 401, code: 'InvalidJWT' })).toBe(
      'signed_capability_expired',
    );
  });

  it('bounds persistent signed-capability expiry to one renewal per logical attempt', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(2_000_000);
    store = createTestStore();
    const job = createQueuedSession(store, Date.now());
    const delivery = new ExpiredCapabilityDelivery(0);
    queue = new UploadQueue(store.repository, store.vault, store.secrets, delivery, Date.now);
    queue.start();

    await vi.advanceTimersByTimeAsync(0);
    expect(delivery.uploadTimes).toEqual([2_000_000, 2_000_000]);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(delivery.uploadTimes).toEqual([2_000_000, 2_000_000, 2_001_000, 2_001_000]);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(delivery.uploadTimes).toHaveLength(6);
    await vi.advanceTimersByTimeAsync(8_000);
    expect(delivery.uploadTimes).toHaveLength(8);

    const failed = store.repository.requireUploadJob(job.id);
    expect(failed.state).toBe('failed');
    expect(failed.attemptCount).toBe(4);
    expect(failed.lifetimeFailureCount).toBe(4);
    expect(store.repository.requireSession(job.sessionId).state).toBe('upload_failed');
  });

  it('claims oldest work FIFO and recovers a lease owned by a dead process', () => {
    store = createTestStore();
    const older = createQueuedSession(store, 100);
    createQueuedSession(store, 200);
    const claimed = store.repository.claimNextDueUpload('old-process', 1_000);
    expect(claimed?.id).toBe(older.id);
    expect(store.repository.recoverUploadLeases('new-process', 1_001)).toBe(1);
    expect(store.repository.requireUploadJob(older.id).state).toBe('queued');
    expect(store.repository.requireSession(older.sessionId).state).toBe('pending_upload');
  });

  it('manual retry resets only its retry cycle and keeps lifetime counts', async () => {
    store = createTestStore();
    const job = createQueuedSession(store, Date.now());
    const delivery = new TransientDelivery(0);
    delivery.permanent = true;
    queue = new UploadQueue(store.repository, store.vault, store.secrets, delivery);
    await queue.processOneNow();
    const failed = store.repository.requireUploadJob(job.id);
    store.repository.retryUpload(job.id);
    const retried = store.repository.requireUploadJob(job.id);
    expect(retried.manualRetryCycle).toBe(failed.manualRetryCycle + 1);
    expect(retried.automaticRetryIndex).toBe(0);
    expect(retried.lifetimeFailureCount).toBe(failed.lifetimeFailureCount);
    expect(retried.attemptCount).toBe(failed.attemptCount);
  });

  it('pauses missing booth authentication without consuming the attempt budget', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(3_000_000);
    store = createTestStore();
    const job = createQueuedSession(store, Date.now());
    const delivery = new AuthPausedDelivery(0);
    delivery.authenticated = false;
    queue = new UploadQueue(store.repository, store.vault, store.secrets, delivery, Date.now);
    queue.start();

    await vi.advanceTimersByTimeAsync(0);
    const paused = store.repository.requireUploadJob(job.id);
    expect(paused).toMatchObject({ state: 'queued', attemptCount: 0, lifetimeFailureCount: 0 });
    expect(paused.nextAttemptAt).toBe(3_030_000);

    delivery.authenticated = true;
    queue.resumeAuthenticationPaused();
    await vi.advanceTimersByTimeAsync(0);
    expect(store.repository.requireUploadJob(job.id)).toMatchObject({
      state: 'succeeded',
      attemptCount: 1,
      lifetimeFailureCount: 0,
    });
  });

  it('immediately completes locally when delivery client is unconfigured', async () => {
    store = createTestStore();
    const job = createQueuedSession(store, Date.now());
    const delivery = new UnconfiguredDelivery();
    queue = new UploadQueue(store.repository, store.vault, store.secrets, delivery);
    expect(await queue.processOneNow()).toBe(true);
    const completed = store.repository.requireUploadJob(job.id);
    expect(completed.state).toBe('succeeded');
    const session = store.repository.requireSession(job.sessionId);
    expect(session.state).toBe('ready');
    expect(session.publicSecretRef).not.toBeNull();
  });

  it('allows completing offline on demand when completeOffline is called', async () => {
    store = createTestStore();
    const job = createQueuedSession(store, Date.now());
    const delivery = new AuthPausedDelivery(0);
    delivery.authenticated = false;
    queue = new UploadQueue(store.repository, store.vault, store.secrets, delivery);
    await queue.completeOffline(job.sessionId);
    const completed = store.repository.requireUploadJob(job.id);
    expect(completed.state).toBe('succeeded');
    const session = store.repository.requireSession(job.sessionId);
    expect(session.state).toBe('ready');
  });
});

function createQueuedSession(store: TestStore, now: number): StoredUploadJob {
  const sessionId = randomUUID();
  store.repository.createSession(sessionId, now);
  store.database.raw
    .prepare("UPDATE sessions SET state = 'processing', capture_count = 3 WHERE id = ?")
    .run(sessionId);
  const stored = store.vault.write('completed', Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  return store.repository.saveCollageAndQueue(
    {
      id: randomUUID(),
      sessionId,
      kind: 'collage',
      retakeRound: 0,
      shotNumber: null,
      encryptedPath: stored.relativePath,
      width: 2_700,
      height: 1_800,
      byteSize: stored.byteSize,
      sha256: stored.sha256,
      createdAt: now,
    },
    randomUUID(),
    now,
  );
}

class TransientDelivery implements DeliveryClient {
  uploadTimes: number[] = [];
  permanent = false;

  constructor(private failuresRemaining: number) {}

  isConfigured(): boolean {
    return true;
  }

  reconfigure(): void {
    void this.failuresRemaining;
  }

  ensureAuthenticated(): Promise<void> {
    return Promise.resolve();
  }

  connect(): Promise<void> {
    return Promise.resolve();
  }

  createUpload(): Promise<CreateUploadResponse> {
    return Promise.resolve({
      photoSessionId: '22222222-2222-4222-8222-222222222222',
      publicToken: PUBLIC_TOKEN,
      upload: {
        storagePath: 'session/collage.jpg',
        signedUploadToken: Buffer.alloc(32, 0x51).toString('base64url'),
        validForSeconds: 7_200,
      },
    });
  }

  resumeUpload(): Promise<ResumeUploadResponse> {
    return Promise.resolve({
      photoSessionId: '22222222-2222-4222-8222-222222222222',
      upload: {
        storagePath: 'session/collage.jpg',
        signedUploadToken: Buffer.alloc(32, 0x52).toString('base64url'),
        validForSeconds: 7_200,
      },
    });
  }

  uploadSigned(): Promise<void> {
    this.uploadTimes.push(Date.now());
    if (this.permanent) {
      return Promise.reject(
        new DeliveryFailure('permanent', 'contract_rejected', 'The upload metadata was rejected.'),
      );
    }
    if (this.failuresRemaining > 0) {
      this.failuresRemaining -= 1;
      return Promise.reject(
        new DeliveryFailure('transient', 'network_error', 'The network is unavailable.'),
      );
    }
    return Promise.resolve();
  }

  confirmUpload(): Promise<ConfirmUploadResponse> {
    const readyAt = Date.now();
    return Promise.resolve({
      status: 'ready',
      readyAt: new Date(readyAt).toISOString(),
      expiresAt: new Date(readyAt + 30 * 24 * 60 * 60 * 1_000).toISOString(),
      publicPageOrigin: 'https://photos.example.test',
      publicPath: '/photo',
    });
  }

  checkPhotoAvailability(): Promise<PhotoAvailability> {
    return Promise.resolve('available');
  }

  authorizePhotoRepair(): Promise<AuthorizePhotoRepairResponse> {
    return Promise.reject(new Error('not used'));
  }

  confirmPhotoRepair(): Promise<ConfirmUploadResponse> {
    return this.confirmUpload();
  }

  health(): Promise<{ healthy: boolean; code: string | null; message: string }> {
    return Promise.resolve({ healthy: true, code: null, message: 'ready' });
  }
}

class ExpiredCapabilityDelivery extends TransientDelivery {
  override uploadSigned(): Promise<void> {
    this.uploadTimes.push(Date.now());
    return Promise.reject(
      new DeliveryFailure(
        'signed_capability_expired',
        'signed_upload_expired',
        'The upload authorization expired and will be renewed.',
      ),
    );
  }
}

class AuthPausedDelivery extends TransientDelivery {
  authenticated = true;

  override ensureAuthenticated(): Promise<void> {
    return this.authenticated
      ? Promise.resolve()
      : Promise.reject(
          new DeliveryFailure(
            'auth',
            'cloud_auth_required',
            'Connect the dedicated booth cloud account.',
          ),
        );
  }
}

class UnconfiguredDelivery implements DeliveryClient {
  isConfigured(): boolean {
    return false;
  }
  reconfigure(): void {
    void this;
  }
  connect(): Promise<void> {
    return Promise.reject(new DeliveryFailure('auth', 'cloud_unconfigured', 'Unconfigured'));
  }
  ensureAuthenticated(): Promise<void> {
    return Promise.reject(new DeliveryFailure('auth', 'cloud_unconfigured', 'Unconfigured'));
  }
  createUpload(): Promise<CreateUploadResponse> {
    return Promise.reject(new DeliveryFailure('auth', 'cloud_unconfigured', 'Unconfigured'));
  }
  resumeUpload(): Promise<ResumeUploadResponse> {
    return Promise.reject(new DeliveryFailure('auth', 'cloud_unconfigured', 'Unconfigured'));
  }
  uploadSigned(): Promise<void> {
    return Promise.reject(new DeliveryFailure('auth', 'cloud_unconfigured', 'Unconfigured'));
  }
  confirmUpload(): Promise<ConfirmUploadResponse> {
    return Promise.reject(new DeliveryFailure('auth', 'cloud_unconfigured', 'Unconfigured'));
  }
  checkPhotoAvailability(): Promise<PhotoAvailability> {
    return Promise.resolve('verification-failed');
  }
  authorizePhotoRepair(): Promise<AuthorizePhotoRepairResponse> {
    return Promise.reject(new DeliveryFailure('auth', 'cloud_unconfigured', 'Unconfigured'));
  }
  confirmPhotoRepair(): Promise<ConfirmUploadResponse> {
    return Promise.reject(new DeliveryFailure('auth', 'cloud_unconfigured', 'Unconfigured'));
  }
  health(): Promise<{ healthy: boolean; code: string | null; message: string }> {
    return Promise.resolve({ healthy: false, code: 'cloud_unconfigured', message: 'Unconfigured' });
  }
}
