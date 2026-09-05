import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import type {
  BoothSnapshot,
  CameraAdapter,
  CaptureResult,
  GuestErrorCode,
  QrStationState,
  SessionState,
} from '@grace-booth/shared';

import type { UploadQueue } from '../cloud/upload-queue.js';
import type { QrService } from '../cloud/qr-service.js';
import { validateReadyReceipt } from '../cloud/ready-receipt.js';
import type { LocalRepository, NewAsset, StoredSession } from '../database/repositories.js';
import { AppError, toSafeError } from '../errors.js';
import type { FrameService } from '../frame/frame-service.js';
import type { ImageProcessor } from '../image/image-worker-client.js';
import type { PhotoVault } from '../storage/photo-vault.js';
import { reduceSessionState, type SessionEvent } from './session-state-machine.js';

const MAX_CAPTURE_BYTES = 50 * 1024 * 1024;
const CANCELLABLE_STATES: readonly SessionState[] = ['countdown', 'capturing', 'review'];

export type BoothWorkflowOptions = {
  shotCountdownsMs: readonly [number, number, number];
  cameraPreviewEnabled?: boolean;
  isDualDisplayActive: () => boolean;
  now?: () => number;
};

export class BoothWorkflow {
  private readonly listeners = new Set<(snapshot: BoothSnapshot) => void>();
  private readonly qrListeners = new Set<(state: QrStationState) => void>();
  private qrStationState: QrStationState = {
    status: 'idle',
    sessionId: null,
    collageUrl: null,
    qrImageUrl: null,
    expiresAt: null,
    durationSeconds: 45,
    queuedCount: 0,
    message: null,
    canRetryUpload: false,
  };
  private readonly qrStationQueue: {
    sessionId: string;
    collageUrl: string | null;
    qrImageUrl: string;
  }[] = [];
  private qrDismissTimer: NodeJS.Timeout | null = null;
  private activeSessionId: string | null = null;
  private countdownEndsAt: number | null = null;
  private countdownTimer: NodeJS.Timeout | null = null;
  private readonly qrBySession = new Map<string, string>();
  private readonly now: () => number;
  private closed = false;

  constructor(
    private readonly repository: LocalRepository,
    private readonly vault: PhotoVault,
    private readonly camera: CameraAdapter,
    private readonly frameService: FrameService,
    private readonly imageProcessor: ImageProcessor,
    private readonly uploadQueue: UploadQueue,
    private readonly qrService: QrService,
    private readonly options: BoothWorkflowOptions,
  ) {
    this.now = options.now ?? Date.now;
    uploadQueue.on('uploading', (sessionId: string) => this.emitIfActive(sessionId));
    uploadQueue.on('ready', (sessionId: string) => void this.handleUploadReady(sessionId));
    uploadQueue.on('failed', (sessionId: string) => this.handleUploadFailed(sessionId));
    uploadQueue.on('auth-required', (sessionId: string) =>
      this.handleUploadAuthRequired(sessionId),
    );
    uploadQueue.on('retry', (sessionId: string) => this.emitIfActive(sessionId));
  }

  async initialize(): Promise<void> {
    await this.frameService.ensureDefaultFrames();
    await (this.frameService as Partial<Pick<FrameService, 'ensureMinistryFrames'>>)
      .ensureMinistryFrames?.();
    const recovered = this.repository.getLatestIncompleteSession();
    this.activeSessionId = recovered?.id ?? null;
    try {
      await this.camera.connect();
    } catch {
      // Warm-up is advisory. Guest Start performs the authoritative connect and recovery transition.
    }
    if (recovered?.state === 'ready' || recovered?.state === 'final') {
      await this.handleUploadReady(recovered.id);
    } else if (recovered?.state === 'interrupted') {
      const currentCaptures = this.repository
        .listCurrentAssets(recovered.id)
        .filter((asset) => asset.kind === 'capture');
      const uploadJob = this.repository.getUploadJobForSession(recovered.id);
      if (recovered.collageAssetId && uploadJob) {
        this.transition(recovered, 'resume_upload', {}, this.now());
      } else if (
        recovered.captureCount === requiredShotCount(recovered) &&
        currentCaptures.length === requiredShotCount(recovered)
      ) {
        this.transition(recovered, 'resume_processing', {}, this.now());
        void this.processCollage(recovered.id);
      } else {
        this.transition(
          recovered,
          'reconcile_partial_capture',
          {
            lastErrorCode: 'capture_interrupted',
            lastErrorMessage:
              'Capture was interrupted. An operator can restart without deleting prior photos.',
          },
          this.now(),
        );
      }
    } else if (recovered?.state === 'processing') {
      void this.processCollage(recovered.id);
    }
    this.uploadQueue.start();
    this.emit();
  }

  subscribe(listener: (snapshot: BoothSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  subscribeQrStation(listener: (state: QrStationState) => void): () => void {
    this.qrListeners.add(listener);
    return () => this.qrListeners.delete(listener);
  }

  getQrStationState(): QrStationState {
    return this.qrStationState;
  }

  dismissQrStation(expectedSessionId?: string | null): QrStationState {
    if (
      expectedSessionId &&
      this.qrStationState.sessionId &&
      this.qrStationState.sessionId !== expectedSessionId
    ) {
      return this.qrStationState;
    }
    if (this.qrDismissTimer) {
      clearTimeout(this.qrDismissTimer);
      this.qrDismissTimer = null;
    }
    const nextItem = this.qrStationQueue.shift();
    if (nextItem) {
      this.presentQrStationItem(nextItem);
      return this.qrStationState;
    }
    this.qrStationState = {
      status: 'idle',
      sessionId: null,
      collageUrl: null,
      qrImageUrl: null,
      expiresAt: null,
      durationSeconds: 45,
      queuedCount: 0,
      message: null,
      canRetryUpload: false,
    };
    this.emitQrStation();
    return this.qrStationState;
  }

  private presentQrStationItem(item: {
    sessionId: string;
    collageUrl: string | null;
    qrImageUrl: string;
  }): void {
    const settings = this.repository.getSettings();
    const duration = settings.qrDismissSeconds || 45;
    const expiresAt = this.now() + duration * 1000;
    this.qrStationState = {
      status: 'active',
      sessionId: item.sessionId,
      collageUrl: item.collageUrl,
      qrImageUrl: item.qrImageUrl,
      expiresAt,
      durationSeconds: duration,
      queuedCount: this.qrStationQueue.length,
      message: null,
      canRetryUpload: false,
    };
    if (this.qrDismissTimer) {
      clearTimeout(this.qrDismissTimer);
      this.qrDismissTimer = null;
    }
    this.qrDismissTimer = setTimeout(() => {
      this.dismissQrStation(item.sessionId);
    }, duration * 1000);
    this.emitQrStation();
  }

  isDualDisplayActive(): boolean {
    return this.options.isDualDisplayActive();
  }

  getSnapshot(): BoothSnapshot {
    const cameraPreviewEnabled = this.options.cameraPreviewEnabled ?? false;
    const session = this.activeSessionId ? this.repository.getSession(this.activeSessionId) : null;
    if (!session || session.state === 'attract')
      return attractSnapshot(cameraPreviewEnabled, this.repository.getActiveFrame()?.slots.length ?? 3);
    const assets = this.repository.listCurrentAssets(session.id);
    const captures = assets
      .filter((asset) => asset.kind === 'capture')
      .sort((left, right) => (left.shotNumber ?? 0) - (right.shotNumber ?? 0));
    const collage = session.collageAssetId
      ? (assets.find((asset) => asset.id === session.collageAssetId) ?? null)
      : null;
    const qrImageUrl = this.qrBySession.get(session.id) ?? null;
    const selectedFrame = session.selectedFrameId
      ? (this.repository.getFrame(session.selectedFrameId) ?? null)
      : this.repository.getActiveFrame();
    const shotCount = session.requiredShotCount;
    return {
      screen: screenFor(session.state, qrImageUrl !== null),
      state: session.state,
      sessionId: session.id,
      shotNumber:
        session.state === 'countdown' || session.state === 'capturing'
          ? Math.min(shotCount, session.captureCount + 1)
          : null,
      captureCount: session.captureCount,
      requiredShotCount: shotCount,
      countdownEndsAt: session.state === 'countdown' ? this.countdownEndsAt : null,
      cameraPreviewEnabled,
      media: {
        captureUrls: captures.map((asset) => mediaUrl(asset.id)),
        collageUrl: collage ? mediaUrl(collage.id) : null,
        frame: selectedFrame ? this.frameService.toSummary(selectedFrame) : null,
        frames: this.frameService.getFrameSummaries().filter((frame) => frame.slots.length === shotCount),
        qrImageUrl,
      },
      controls: {
        canStart: false,
        canRetakeAll: session.state === 'review',
        canAcceptPhotos: session.state === 'review' && session.captureCount === shotCount,
        canRetryUpload: session.state === 'upload_failed',
        canFinishOffline:
          session.state === 'upload_failed' ||
          (session.state === 'pending_upload' && !!session.collageAssetId),
        canFinish: session.state === 'final' && qrImageUrl !== null,
      },
      errorCode: guestErrorFor(session),
      message: messageFor(session),
    };
  }

  setCameraPreviewEnabled(enabled: boolean): void {
    this.options.cameraPreviewEnabled = enabled;
    this.emit();
  }

  async start(): Promise<BoothSnapshot> {
    if (this.activeSessionId) {
      const current = this.repository.getSession(this.activeSessionId);
      if (current && current.state !== 'attract') {
        throw new AppError('session_active', 'A photo session is already in progress.');
      }
    }
    const activeFrame = this.repository.getActiveFrame();
    const session = this.repository.createSession(
      randomUUID(),
      this.now(),
      activeFrame?.id ?? null,
      activeFrame?.slots.length ?? 3,
    );
    if (reduceSessionState('attract', 'start') !== session.state) {
      throw new AppError('state_conflict', 'The new session state is invalid.');
    }
    this.activeSessionId = session.id;
    if (!(await this.connectCameraFor(session))) return this.getSnapshot();
    this.beginCountdown(session);
    return this.getSnapshot();
  }

  retakeAll(): BoothSnapshot {
    const session = this.requireActive();
    if (session.state !== 'review')
      throw new AppError('retake_unavailable', 'Retake is not available now.');
    this.beginCountdown(this.repository.startRetakeRound(session.id, this.now()));
    return this.getSnapshot();
  }

  acceptPhotos(frameId: string): BoothSnapshot {
    const session = this.requireActive();
    const lockedShotCount = requiredShotCount(session);
    if (session.state !== 'review' || session.captureCount !== lockedShotCount)
      throw new AppError('review_incomplete', `${lockedShotCount} photos are required before processing.`);
    const chosenFrame = this.repository.getFrame(frameId);
    if (!chosenFrame) {
      throw new AppError('frame_missing', 'The selected photo frame is missing.');
    }
    if (chosenFrame.archived || chosenFrame.slots.length !== lockedShotCount) {
      throw new AppError('frame_incompatible', 'Choose a visible frame with the same number of slots.');
    }
    this.transition(
      session,
      'accept_photos',
      {
        selectedOption: 1,
        selectedFrameId: chosenFrame.id,
      },
      this.now(),
    );
    const dualActive = this.isDualDisplayActive();
    if (dualActive) {
      this.activeSessionId = null;
      this.emit();
    } else {
      this.emit();
    }
    void this.processCollage(session.id);
    return dualActive
      ? attractSnapshot(this.options.cameraPreviewEnabled ?? false, this.repository.getActiveFrame()?.slots.length ?? 3)
      : this.getSnapshot();
  }

  retryUpload(): BoothSnapshot {
    const session = this.requireActive();
    if (session.state !== 'upload_failed') {
      throw new AppError('upload_not_retryable', 'The upload does not need a retry.');
    }
    const job = this.repository.getUploadJobForSession(session.id);
    if (!job) throw new AppError('upload_job_missing', 'The upload job could not be found.');
    this.repository.retryUpload(job.id, this.now());
    this.uploadQueue.wake();
    this.emit();
    return this.getSnapshot();
  }

  async finishOffline(): Promise<BoothSnapshot> {
    const session = this.requireActive();
    if (session.state !== 'upload_failed' && session.state !== 'pending_upload') {
      throw new AppError('offline_delivery_unavailable', 'Finish offline is not available now.');
    }
    await this.uploadQueue.completeOffline(session.id);
    await this.handleUploadReady(session.id);
    return this.getSnapshot();
  }

  done(): BoothSnapshot {
    const session = this.requireActive();
    if (session.state !== 'final' || !this.qrBySession.has(session.id)) {
      throw new AppError('finish_unavailable', 'The photo is not ready to finish.');
    }
    this.transition(session, 'done', { completedAt: this.now() }, this.now());
    this.qrBySession.delete(session.id);
    this.activeSessionId = null;
    this.emit();
    return attractSnapshot(this.options.cameraPreviewEnabled ?? false, this.repository.getActiveFrame()?.slots.length ?? 3);
  }

  /**
   * Guest-facing abort: purges every capture and vault file belonging to the live session and
   * returns the booth to Attract. Idempotent — cancelling a session that is missing or already
   * left a cancellable state simply reports the current snapshot without deleting anything.
   */
  cancelSession(): BoothSnapshot {
    const sessionId = this.activeSessionId;
    if (!sessionId) return this.getSnapshot();
    const session = this.repository.getSession(sessionId);
    if (!session || !CANCELLABLE_STATES.includes(session.state)) {
      return this.getSnapshot();
    }
    if (this.countdownTimer) {
      clearTimeout(this.countdownTimer);
      this.countdownTimer = null;
    }
    this.countdownEndsAt = null;
    this.camera.abortCapture?.();
    // Detach first so an in-flight capture cannot re-attach to a deleted session.
    this.activeSessionId = null;
    this.qrBySession.delete(sessionId);
    for (const asset of this.repository.listAssets(sessionId)) {
      try {
        this.vault.delete(asset.encryptedPath);
      } catch {
        // The row removal below is authoritative; a missing file is not a cancellation failure.
      }
    }
    this.repository.deleteSession(sessionId);
    this.emit();
    return this.getSnapshot();
  }

  async restartSession(sessionId: string): Promise<BoothSnapshot> {
    const session = this.repository.requireSession(sessionId);
    if (this.activeSessionId !== sessionId) {
      throw new AppError('session_not_active', 'That photo session is not active.');
    }
    if (session.state === 'upload_failed') return this.retryUpload();
    if (session.state !== 'camera_error' && session.state !== 'interrupted') {
      throw new AppError('restart_unavailable', 'This photo session does not need a restart.');
    }
    if (!(await this.connectCameraFor(session))) return this.getSnapshot();
    this.beginCountdown(this.repository.startRetakeRound(session.id, this.now()));
    return this.getSnapshot();
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.countdownTimer) clearTimeout(this.countdownTimer);
    if (this.qrDismissTimer) {
      clearTimeout(this.qrDismissTimer);
      this.qrDismissTimer = null;
    }
    this.uploadQueue.stop();
    await Promise.all([this.camera.disconnect(), this.imageProcessor.close()]);
  }

  private beginCountdown(session: StoredSession): void {
    if (session.state !== 'countdown')
      throw new AppError('state_conflict', 'Countdown cannot start now.');
    if (this.countdownTimer) clearTimeout(this.countdownTimer);
    const shotCount = requiredShotCount(session);
    const shotNumber = Math.min(shotCount, session.captureCount + 1);
    const durationMs = this.options.shotCountdownsMs[shotNumber - 1] ?? this.options.shotCountdownsMs.at(-1);
    if (durationMs === undefined) {
      throw new AppError('state_conflict', 'Countdown cannot start now.');
    }
    this.countdownEndsAt = this.now() + durationMs;
    this.countdownTimer = setTimeout(() => void this.captureNext(session.id), durationMs);
    this.emit();
  }

  private async captureNext(sessionId: string): Promise<void> {
    if (this.closed || this.activeSessionId !== sessionId) return;
    this.countdownTimer = null;
    this.countdownEndsAt = null;
    let session = this.repository.requireSession(sessionId);
    try {
      session = this.transition(session, 'countdown_elapsed', {}, this.now());
      this.emit();
      const captureId = randomUUID();
      const result = await this.camera.capture({
        sessionId,
        captureId,
        shotNumber: session.captureCount + 1,
        timeoutMs: 120_000,
      });
      const bytes = await captureBytes(result);
      const metadata = await this.imageProcessor.validateSourceJpeg(bytes);
      const stored = this.vault.write('pending', bytes);
      const asset: NewAsset = {
        id: captureId,
        sessionId,
        kind: 'capture',
        retakeRound: session.captureRound,
        shotNumber: session.captureCount + 1,
        encryptedPath: stored.relativePath,
        width: metadata.width,
        height: metadata.height,
        byteSize: stored.byteSize,
        sha256: stored.sha256,
        createdAt: this.now(),
      };
      try {
        session = this.repository.addCapture(asset, this.now());
      } catch (error) {
        this.vault.delete(stored.relativePath);
        throw error;
      }
      if (session.state === 'countdown') this.beginCountdown(session);
      else this.emit();
    } catch (error) {
      const safe = toSafeError(error);
      const current = this.repository.getSession(sessionId);
      if (current?.state === 'capturing' || current?.state === 'countdown') {
        this.transition(
          current,
          'camera_failed',
          {
            lastErrorCode: safe.code.slice(0, 80),
            lastErrorMessage:
              'The camera could not take the photo. Please ask an operator for help.',
          },
          this.now(),
        );
      }
      this.emit();
    }
  }

  private async processCollage(sessionId: string): Promise<void> {
    try {
      const assets = this.repository
        .listCurrentAssets(sessionId)
        .filter((asset) => asset.kind === 'capture')
        .sort((left, right) => (left.shotNumber ?? 0) - (right.shotNumber ?? 0));
      const session = this.repository.requireSession(sessionId);
      const shotCount = requiredShotCount(session);
      if (assets.length !== shotCount)
        throw new AppError('capture_count', `${shotCount} photos are required.`);
      const captures = assets.map((asset) => this.vault.read(asset.encryptedPath));
      const frame =
        (session.selectedFrameId ? this.repository.getFrame(session.selectedFrameId) : null) ??
        this.repository.getActiveFrame();
      if (!frame) throw new AppError('frame_missing', 'The active photo frame is missing.');
      const framePng = this.vault.read(frame.encryptedPath);
      const result = await this.imageProcessor.process({
        captures,
        framePng,
        slots: frame.slots,
        frameAspectRatio: frame.width / frame.height,
      });
      if (result.byteSize !== result.bytes.byteLength || result.byteSize < 1) {
        throw new AppError(
          'output_validation',
          'The finished photo could not be validated.',
        );
      }
      const stored = this.vault.write('completed', result.bytes);
      const assetId = randomUUID();
      try {
        this.repository.saveCollageAndQueue(
          {
            id: assetId,
            sessionId,
            kind: 'collage',
            retakeRound: this.repository.requireSession(sessionId).captureRound,
            shotNumber: null,
            encryptedPath: stored.relativePath,
            width: result.width,
            height: result.height,
            byteSize: stored.byteSize,
            sha256: stored.sha256,
            createdAt: this.now(),
          },
          randomUUID(),
          this.now(),
        );
      } catch (error) {
        this.vault.delete(stored.relativePath);
        throw error;
      }
      this.uploadQueue.wake();
      this.emit();
    } catch (error) {
      const safe = toSafeError(error);
      const session = this.repository.getSession(sessionId);
      if (session?.state === 'processing') {
        this.transition(
          session,
          'processing_interrupted',
          {
            lastErrorCode: safe.code.slice(0, 80),
            lastErrorMessage: safe.safeMessage.slice(0, 300),
          },
          this.now(),
        );
      }
      this.emit();
    }
  }

  private handleUploadAuthRequired(sessionId: string): void {
    const session = this.repository.getSession(sessionId);
    if (!session) return;
    if (session.state === 'uploading' || session.state === 'pending_upload') {
      try {
        this.transition(
          session,
          'upload_failed',
          {
            lastErrorCode: 'cloud_auth_required',
            lastErrorMessage:
              'Cloud connection is unauthenticated. Connect the booth account in settings or finish offline.',
          },
          this.now(),
        );
      } catch {
        // Handled if already transitioned
      }
    }
    this.emitIfActive(sessionId);
  }

  private handleUploadFailed(sessionId: string): void {
    const session = this.repository.getSession(sessionId);
    if (!session) return;
    if (session.state === 'uploading' || session.state === 'pending_upload') {
      try {
        this.transition(
          session,
          'upload_failed',
          {
            lastErrorCode: session.lastErrorCode ?? 'upload_failed',
            lastErrorMessage:
              session.lastErrorMessage ??
              'The photo upload could not be completed. You can retry or finish offline.',
          },
          this.now(),
        );
      } catch {
        // Handled if already transitioned
      }
    }
    const sessionAssets = this.repository.listCurrentAssets(sessionId);
    const collage = sessionAssets.find((asset) => asset.kind === 'collage');
    if (collage) {
      this.qrStationState = {
        status: 'error',
        sessionId,
        collageUrl: mediaUrl(collage.id),
        qrImageUrl: null,
        expiresAt: null,
        durationSeconds: 45,
        queuedCount: this.qrStationQueue.length,
        message: 'Upload failed. You can finish offline or retry.',
        canRetryUpload: true,
      };
      this.emitQrStation();
    }
    this.emitIfActive(sessionId);
  }

  private async handleUploadReady(sessionId: string): Promise<void> {
    const session = this.repository.getSession(sessionId);
    if (!session?.publicSecretRef) return;
    const secret = this.uploadQueue.readDeliverySecret(session.publicSecretRef);
    if (!secret.ready) return;
    const receipt = validateReadyReceipt(secret.photoSessionId, secret.publicToken, secret.ready);
    const qr = await this.qrService.render(receipt);
    this.qrBySession.set(sessionId, qr.imageDataUrl);
    const current = this.repository.requireSession(sessionId);
    if (current.state === 'ready') {
      this.transition(current, 'qr_ready', {}, this.now());
    }
    const sessionAssets = this.repository.listCurrentAssets(sessionId);
    const collage = sessionAssets.find((asset) => asset.kind === 'collage');
    const item = {
      sessionId,
      collageUrl: collage ? mediaUrl(collage.id) : null,
      qrImageUrl: qr.imageDataUrl,
    };
    if (this.qrStationState.status === 'active' && this.qrStationState.sessionId !== sessionId) {
      this.qrStationQueue.push(item);
      this.qrStationState = {
        ...this.qrStationState,
        queuedCount: this.qrStationQueue.length,
      };
      this.emitQrStation();
      this.emitIfActive(sessionId);
      return;
    }
    this.presentQrStationItem(item);
    this.emitIfActive(sessionId);
  }

  private requireActive(): StoredSession {
    if (!this.activeSessionId) throw new AppError('session_missing', 'No photo session is active.');
    return this.repository.requireSession(this.activeSessionId);
  }

  private async connectCameraFor(session: StoredSession): Promise<boolean> {
    try {
      const status = await this.camera.connect();
      if (status.state !== 'ready' || !status.capabilities.stillCapture) {
        throw new AppError(
          status.code ?? 'camera_unavailable',
          status.operatorMessage || 'The camera is unavailable.',
        );
      }
      return true;
    } catch (error) {
      const safe = toSafeError(error);
      const current = this.repository.requireSession(session.id);
      if (current.state === 'countdown') {
        this.transition(
          current,
          'camera_failed',
          {
            lastErrorCode: safe.code.slice(0, 80),
            lastErrorMessage: 'The camera is unavailable. Please ask an operator for help.',
          },
          this.now(),
        );
      }
      this.emit();
      return false;
    }
  }

  private transition(
    session: StoredSession,
    event: SessionEvent,
    patch: Parameters<LocalRepository['transitionSession']>[3] = {},
    now = this.now(),
  ): StoredSession {
    const next = reduceSessionState(session.state, event);
    return this.repository.transitionSession(session.id, [session.state], next, patch, now);
  }

  private emitIfActive(sessionId: string): void {
    if (this.activeSessionId === sessionId) this.emit();
  }

  private emitQrStation(): void {
    for (const listener of this.qrListeners) listener(this.qrStationState);
  }

  private emit(): void {
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) listener(snapshot);
  }
}

function attractSnapshot(cameraPreviewEnabled: boolean, requiredShotCount = 3): BoothSnapshot {
  return {
    screen: 'attract',
    state: null,
    sessionId: null,
    shotNumber: null,
    captureCount: 0,
    requiredShotCount,
    countdownEndsAt: null,
    cameraPreviewEnabled,
    media: { captureUrls: [], collageUrl: null, qrImageUrl: null },
    controls: {
      canStart: true,
      canRetakeAll: false,
      canAcceptPhotos: false,
      canRetryUpload: false,
      canFinishOffline: false,
      canFinish: false,
    },
    errorCode: null,
    message: null,
  };
}

function screenFor(state: SessionState, qrReady: boolean): BoothSnapshot['screen'] {
  if (state === 'countdown') return 'countdown';
  if (state === 'capturing') return 'capturing';
  if (state === 'review') return 'review';
  if (
    state === 'processing' ||
    state === 'pending_upload' ||
    state === 'uploading' ||
    state === 'ready'
  ) {
    return qrReady ? 'final' : 'processing';
  }
  if (state === 'final') return qrReady ? 'final' : 'processing';
  if (state === 'camera_error' || state === 'upload_failed' || state === 'interrupted')
    return 'recovery';
  return 'attract';
}

function guestErrorFor(session: StoredSession): GuestErrorCode | null {
  if (session.state === 'camera_error') return 'capture_failed';
  if (session.state === 'upload_failed') return 'upload_failed';
  if (session.state === 'interrupted') {
    return session.lastErrorCode?.includes('processing') ? 'processing_failed' : 'interrupted';
  }
  return null;
}

function messageFor(session: StoredSession): string | null {
  if (session.state === 'processing') return 'Creating your Grace Booth collage…';
  if (session.state === 'pending_upload')
    return 'Your collage is saved. Preparing secure delivery…';
  if (session.state === 'uploading') return 'Securely uploading your collage…';
  if (session.state === 'ready') return 'Preparing your private QR code…';
  if (session.state === 'camera_error')
    return 'We couldn’t take that photo. Please ask an operator for help.';
  if (session.state === 'upload_failed') {
    return (
      session.lastErrorMessage ??
      'Your photo is saved on this booth. Select Retry upload when the connection is ready, or finish offline.'
    );
  }
  if (session.state === 'interrupted')
    return 'This session needs an operator to restart it safely.';
  return null;
}

function mediaUrl(identifier: string): string {
  return `grace-booth-media://asset/${identifier}`;
}

function requiredShotCount(session: StoredSession): number {
  return session.requiredShotCount;
}

async function captureBytes(result: CaptureResult): Promise<Buffer> {
  if (result.kind === 'buffer') return Buffer.from(result.bytes);
  const bytes = await readFile(result.path);
  if (bytes.byteLength > MAX_CAPTURE_BYTES) {
    throw new AppError('capture_size', 'The camera photo exceeds the safe size limit.');
  }
  return bytes;
}
