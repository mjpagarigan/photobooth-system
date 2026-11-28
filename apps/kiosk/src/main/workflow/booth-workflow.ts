import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import {
  MAX_CAPTURE_COUNTDOWN_SECONDS,
  MIN_CAPTURE_COUNTDOWN_SECONDS,
  isCancellableSessionState,
  isPrintableFrameSize,
  isSessionPrintActive,
  qrStationAllowsAutoDismiss,
  type BoothSnapshot,
  type CameraAdapter,
  type CaptureResult,
  type CaptureSettings,
  type DeliveryMode,
  type GuestErrorCode,
  type QrStationState,
  type SessionPrintRequest,
  type SessionPrintStatus,
  type SessionState,
} from '@grace-booth/shared';

import type { UploadQueue } from '../cloud/upload-queue.js';
import type { QrService } from '../cloud/qr-service.js';
import { validateReadyReceipt } from '../cloud/ready-receipt.js';
import type { CapturePolicyOverride } from '../config.js';
import type {
  LocalRepository,
  LocalSettings,
  NewAsset,
  StoredSession,
} from '../database/repositories.js';
import { AppError, toSafeError } from '../errors.js';
import type { FrameService } from '../frame/frame-service.js';
import type { ImageProcessor } from '../image/image-worker-client.js';
import type { WorkflowPrintPort } from '../print/print-service.js';
import {
  isSameSessionPrintStatus,
  type SessionPrintChangeEvent,
} from '../print/session-print-status.js';
import type { PhotoVault } from '../storage/photo-vault.js';
import { BackgroundPrintTracker } from './background-print-tracker.js';
import { reduceSessionState, type SessionEvent } from './session-state-machine.js';

const MAX_CAPTURE_BYTES = 50 * 1024 * 1024;

export type BoothWorkflowOptions = {
  captureOverride?: CapturePolicyOverride | null;
  cameraPreviewEnabled?: boolean;
  isDualDisplayActive: () => boolean;
  now?: () => number;
  /** The print queue. Absent in builds or tests without printing. */
  print?: WorkflowPrintPort;
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
    message: null,
    canRetryUpload: false,
    canFinishOffline: false,
    printStatus: null,
  };
  private latestQrStationSession: { createdAt: number; sessionId: string } | null = null;
  private qrDismissTimer: NodeJS.Timeout | null = null;
  private activeSessionId: string | null = null;
  private countdownEndsAt: number | null = null;
  private countdownTotalSeconds: number | null = null;
  private countdownTimer: NodeJS.Timeout | null = null;
  private readonly qrBySession = new Map<string, string>();
  private readonly deliveryModeBySession = new Map<string, DeliveryMode>();
  private readonly now: () => number;
  private unsubscribePrint: (() => void) | null;
  private lastEmittedMonitor1PrintStatus: SessionPrintStatus | null = null;
  private readonly backgroundPrint: BackgroundPrintTracker;
  private suppressingPrintBroadcast = false;
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
    this.backgroundPrint = new BackgroundPrintTracker(() => {
      if (!this.closed && !this.activeSessionId) this.emit();
    });
    uploadQueue.on('uploading', (sessionId: string) => this.handleUploadStarted(sessionId));
    uploadQueue.on('ready', (sessionId: string) => void this.handleUploadReady(sessionId));
    uploadQueue.on('failed', (sessionId: string) => this.handleUploadFailed(sessionId));
    uploadQueue.on('auth-required', (sessionId: string) =>
      this.handleUploadAuthRequired(sessionId),
    );
    uploadQueue.on('retry', (sessionId: string) => this.emitIfActive(sessionId));
    this.unsubscribePrint =
      options.print?.subscribeSessionChanges((event) => this.handlePrintChange(event)) ?? null;
  }

  async initialize(): Promise<void> {
    await this.frameService.ensureDefaultFrames();
    await (
      this.frameService as Partial<Pick<FrameService, 'ensureMinistryFrames'>>
    ).ensureMinistryFrames?.();
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
      if (recovered.lastErrorCode === 'local_asset_unavailable') {
        this.transition(
          recovered,
          'reconcile_partial_capture',
          {
            lastErrorCode: recovered.lastErrorCode,
            lastErrorMessage:
              recovered.lastErrorMessage ??
              'A local photo could not be verified. Operator recovery is required.',
          },
          this.now(),
        );
      } else {
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
    this.clearQrDismissTimer();
    this.qrStationState = {
      status: 'idle',
      sessionId: null,
      collageUrl: null,
      qrImageUrl: null,
      expiresAt: null,
      durationSeconds: 45,
      message: null,
      canRetryUpload: false,
      canFinishOffline: false,
      printStatus: null,
    };
    this.emitQrStation();
    return this.qrStationState;
  }

  retryQrStationUpload(sessionId: string): QrStationState {
    if (this.qrStationState.status !== 'error' || this.qrStationState.sessionId !== sessionId) {
      return this.qrStationState;
    }
    const session = this.repository.getSession(sessionId);
    if (session?.state !== 'upload_failed') {
      throw new AppError('upload_not_retryable', 'The upload does not need a retry.');
    }
    const job = this.repository.getUploadJobForSession(session.id);
    if (!job) throw new AppError('upload_job_missing', 'The upload job could not be found.');
    this.repository.retryUpload(job.id, this.now());
    const duration = this.repository.getSettings().qrDismissSeconds || 45;
    const printStatus = this.readPrintStatusForSession(session.id, session);
    this.qrStationState = {
      ...this.qrStationState,
      expiresAt: this.applyQrStationTimer(session.id, duration, printStatus),
      durationSeconds: duration,
      message: 'Retrying cloud upload…',
      canRetryUpload: false,
      canFinishOffline: true,
      printStatus,
    };
    this.emitQrStation();
    this.uploadQueue.wake();
    return this.qrStationState;
  }

  async finishQrStationOffline(sessionId: string): Promise<QrStationState> {
    if (this.qrStationState.status !== 'error' || this.qrStationState.sessionId !== sessionId) {
      return this.qrStationState;
    }
    const session = this.repository.getSession(sessionId);
    if (!session || (session.state !== 'upload_failed' && session.state !== 'pending_upload')) {
      throw new AppError('offline_delivery_unavailable', 'Finish offline is not available now.');
    }
    await this.uploadQueue.completeOffline(session.id);
    await this.handleUploadReady(session.id);
    return this.qrStationState;
  }

  private clearQrDismissTimer(): void {
    if (this.qrDismissTimer) {
      clearTimeout(this.qrDismissTimer);
      this.qrDismissTimer = null;
    }
  }

  private applyQrStationTimer(
    sessionId: string,
    durationSeconds: number,
    printStatus: SessionPrintStatus | null,
  ): number | null {
    this.clearQrDismissTimer();
    if (isSessionPrintActive(printStatus)) {
      return null;
    }
    const expiresAt = this.now() + durationSeconds * 1000;
    this.qrDismissTimer = setTimeout(() => {
      this.dismissQrStation(sessionId);
    }, durationSeconds * 1000);
    return expiresAt;
  }

  private stageQrStationPreparing(session: StoredSession): boolean {
    if (!this.canPresentQrStationSession(session.id, session.createdAt)) return false;
    this.latestQrStationSession = { sessionId: session.id, createdAt: session.createdAt };
    this.clearQrDismissTimer();
    const duration = this.repository.getSettings().qrDismissSeconds || 45;
    const printStatus = this.readPrintStatusForSession(session.id, session);
    this.qrStationState = {
      status: 'preparing',
      sessionId: session.id,
      collageUrl: null,
      qrImageUrl: null,
      expiresAt: null,
      durationSeconds: duration,
      message: 'Creating your collage…',
      canRetryUpload: false,
      canFinishOffline: false,
      printStatus,
    };
    return true;
  }

  private updateQrStationPreparing(
    sessionId: string,
    patch: { collageUrl?: string | null; message?: string | null },
  ): void {
    if (this.qrStationState.status !== 'preparing' || this.qrStationState.sessionId !== sessionId) {
      return;
    }
    const nextCollageUrl =
      patch.collageUrl !== undefined ? patch.collageUrl : this.qrStationState.collageUrl;
    const nextMessage = patch.message !== undefined ? patch.message : this.qrStationState.message;
    const nextPrintStatus = this.readPrintStatusForSession(sessionId);
    if (
      nextCollageUrl === this.qrStationState.collageUrl &&
      nextMessage === this.qrStationState.message &&
      isSameSessionPrintStatus(this.qrStationState.printStatus ?? null, nextPrintStatus)
    ) {
      return;
    }
    this.qrStationState = {
      ...this.qrStationState,
      collageUrl: nextCollageUrl,
      message: nextMessage,
      printStatus: nextPrintStatus,
    };
    this.emitQrStation();
  }

  private presentQrStationItem(item: {
    sessionId: string;
    createdAt: number;
    collageUrl: string | null;
    qrImageUrl: string;
    deliveryMode: DeliveryMode;
  }): void {
    if (!this.isDualDisplayActive() && this.qrStationState.sessionId !== item.sessionId) return;
    if (!this.canPresentQrStationSession(item.sessionId, item.createdAt)) return;
    this.latestQrStationSession = { sessionId: item.sessionId, createdAt: item.createdAt };
    const settings = this.repository.getSettings();
    const duration = settings.qrDismissSeconds || 45;
    const printStatus = this.readPrintStatusForSession(item.sessionId);
    const expiresAt = this.applyQrStationTimer(item.sessionId, duration, printStatus);
    this.qrStationState = {
      status: 'active',
      sessionId: item.sessionId,
      collageUrl: item.collageUrl,
      qrImageUrl: item.qrImageUrl,
      expiresAt,
      durationSeconds: duration,
      message: null,
      canRetryUpload: false,
      canFinishOffline: false,
      deliveryMode: item.deliveryMode,
      printStatus,
    };
    this.emitQrStation();
  }

  private canPresentQrStationSession(sessionId: string, createdAt: number): boolean {
    const latest = this.latestQrStationSession;
    if (!latest || latest.sessionId === sessionId) return true;
    return (
      createdAt > latest.createdAt ||
      (createdAt === latest.createdAt && sessionId > latest.sessionId)
    );
  }

  private presentQrStationError(session: StoredSession, collageUrl: string | null): void {
    if (!this.isDualDisplayActive() && this.qrStationState.sessionId !== session.id) return;
    if (!this.canPresentQrStationSession(session.id, session.createdAt)) return;
    this.latestQrStationSession = { sessionId: session.id, createdAt: session.createdAt };
    const current = this.repository.getSession(session.id) ?? session;
    const job = this.repository.getUploadJobForSession(current.id);
    const canRetryUpload = current.state === 'upload_failed' && job !== null;
    const canFinishOffline =
      current.state === 'upload_failed' || current.state === 'pending_upload';
    const duration = this.repository.getSettings().qrDismissSeconds || 45;
    const printStatus = this.readPrintStatusForSession(current.id, current);
    const expiresAt = this.applyQrStationTimer(current.id, duration, printStatus);
    this.qrStationState = {
      status: 'error',
      sessionId: current.id,
      collageUrl,
      qrImageUrl: null,
      expiresAt,
      durationSeconds: duration,
      message:
        canRetryUpload || canFinishOffline
          ? 'Your photo is safe on this booth. Retry upload, or finish offline over the booth’s network.'
          : current.state === 'interrupted'
            ? 'We could not finish creating your photo. Ask an operator for help or try another photo session.'
            : 'Upload failed. Ask an operator for help or try another photo session.',
      canRetryUpload,
      canFinishOffline,
      printStatus,
    };
    this.emitQrStation();
  }

  isDualDisplayActive(): boolean {
    return this.options.isDualDisplayActive();
  }

  getSnapshot(): BoothSnapshot {
    const cameraPreviewEnabled = this.options.cameraPreviewEnabled ?? false;
    const session = this.activeSessionId ? this.repository.getSession(this.activeSessionId) : null;
    if (!session || session.state === 'attract') {
      const printStatus = this.backgroundPrint.peekStatus((id) =>
        this.readPrintStatusForSession(id),
      );
      return attractSnapshot(
        cameraPreviewEnabled,
        this.repository.getActiveFrame()?.slots.length ?? 3,
        printStatus,
      );
    }
    const assets = this.repository.listCurrentAssets(session.id);
    const captures = assets
      .filter((asset) => asset.kind === 'capture')
      .sort((left, right) => (left.shotNumber ?? 0) - (right.shotNumber ?? 0));
    const collage = session.collageAssetId
      ? (assets.find((asset) => asset.id === session.collageAssetId) ?? null)
      : null;
    const qrImageUrl = this.qrBySession.get(session.id) ?? null;
    const deliveryMode = this.deliveryModeBySession.get(session.id);
    const selectedFrame = session.selectedFrameId
      ? (this.repository.getFrame(session.selectedFrameId) ?? null)
      : this.repository.getActiveFrame();
    const shotCount = session.requiredShotCount;
    return {
      screen: screenFor(session.state, qrImageUrl !== null),
      state: session.state,
      sessionId: session.id,
      shotNumber:
        session.state === 'countdown' ||
        session.state === 'capturing' ||
        session.state === 'shot_review'
          ? Math.min(shotCount, session.captureCount + 1)
          : null,
      captureCount: session.captureCount,
      requiredShotCount: shotCount,
      countdownEndsAt: session.state === 'countdown' ? this.countdownEndsAt : null,
      countdownTotalSeconds: session.state === 'countdown' ? this.countdownTotalSeconds : null,
      cameraPreviewEnabled,
      ...(deliveryMode ? { deliveryMode } : {}),
      media: {
        captureUrls: captures.map((asset) => mediaUrl(asset.id)),
        collageUrl: collage ? mediaUrl(collage.id) : null,
        frame: selectedFrame ? this.frameService.toSummary(selectedFrame) : null,
        frames: this.frameService
          .getFrameSummaries()
          .filter((frame) => frame.slots.length === shotCount),
        qrImageUrl,
      },
      controls: {
        canStart: false,
        canAcceptShot:
          session.state === 'shot_review' && captures.length === session.captureCount + 1,
        canRetakeShot: session.state === 'shot_review',
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
      printStatus: this.projectPrintStatus(session),
    };
  }

  refreshIdleSnapshot(): void {
    const session = this.activeSessionId ? this.repository.getSession(this.activeSessionId) : null;
    if (!session || session.state === 'attract') {
      this.emit();
    }
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
    const settings = this.repository.getSettings();
    const activeFrame = this.repository.getActiveFrame();
    const capturePolicy = resolveSessionCapturePolicy(settings, this.options.captureOverride);
    const session = this.repository.createSession(
      randomUUID(),
      this.now(),
      activeFrame?.id ?? null,
      activeFrame?.slots.length ?? 3,
      capturePolicy,
    );
    if (reduceSessionState('attract', 'start') !== session.state) {
      throw new AppError('state_conflict', 'The new session state is invalid.');
    }
    this.activeSessionId = session.id;
    if (!(await this.connectCameraFor(session))) return this.getSnapshot();
    if (!this.isSessionCurrent(session.id)) return this.getSnapshot();
    this.beginCountdown(session);
    return this.getSnapshot();
  }

  async acceptShot(shotNumber: number): Promise<BoothSnapshot> {
    const session = this.requireActive();
    if (
      (session.state === 'countdown' && session.captureCount >= shotNumber) ||
      (session.state === 'review' && shotNumber === session.requiredShotCount)
    ) {
      return this.getSnapshot();
    }
    if (session.state !== 'shot_review' || shotNumber !== session.captureCount + 1) {
      throw new AppError(
        'shot_review_unavailable',
        'That photo is no longer waiting for confirmation.',
      );
    }
    const next = this.repository.acceptShot(session.id, shotNumber, this.now());
    if (next.state === 'review') {
      this.clearCountdown();
      this.emit();
      return this.getSnapshot();
    }
    if (!(await this.connectCameraFor(next))) return this.getSnapshot();
    if (!this.isSessionCurrent(next.id)) return this.getSnapshot();
    this.beginCountdown(next);
    return this.getSnapshot();
  }

  async retakeShot(shotNumber: number): Promise<BoothSnapshot> {
    const session = this.requireActive();
    if (session.state === 'countdown' && session.captureCount + 1 === shotNumber) {
      return this.getSnapshot();
    }
    if (session.state !== 'shot_review' || shotNumber !== session.captureCount + 1) {
      throw new AppError('retake_unavailable', 'That photo can no longer be retaken.');
    }
    const next = this.repository.retakeShot(session.id, shotNumber, this.now());
    if (!(await this.connectCameraFor(next))) return this.getSnapshot();
    if (!this.isSessionCurrent(next.id)) return this.getSnapshot();
    this.beginCountdown(next);
    return this.getSnapshot();
  }

  retakeAll(): BoothSnapshot {
    const session = this.requireActive();
    if (session.state !== 'review')
      throw new AppError('retake_unavailable', 'Retake is not available now.');
    this.beginCountdown(this.repository.startRetakeRound(session.id, this.now()));
    return this.getSnapshot();
  }

  acceptPhotos(frameId: string, print: SessionPrintRequest | null = null): BoothSnapshot {
    const session = this.requireActive();
    const lockedShotCount = requiredShotCount(session);
    if (session.state !== 'review' || session.captureCount !== lockedShotCount)
      throw new AppError(
        'review_incomplete',
        `${lockedShotCount} photos are required before processing.`,
      );
    const chosenFrame = this.repository.getFrame(frameId);
    if (!chosenFrame) {
      throw new AppError('frame_missing', 'The selected photo frame is missing.');
    }
    if (chosenFrame.archived || chosenFrame.slots.length !== lockedShotCount) {
      throw new AppError(
        'frame_incompatible',
        'Choose a visible frame with the same number of slots.',
      );
    }
    if (print) {
      if (!this.options.print) {
        throw new AppError('print_unavailable', 'Printing is not available on this booth.');
      }
      if (!isPrintableFrameSize(chosenFrame.width, chosenFrame.height)) {
        throw new AppError(
          'print_frame_unsupported',
          'Only landscape 4R frames can be printed. Turn printing off or pick a 4R frame.',
        );
      }
    }
    const stagedQrPreparing = this.withoutPrintBroadcast(() => {
      this.transition(
        session,
        'accept_photos',
        {
          selectedOption: 1,
          selectedFrameId: chosenFrame.id,
        },
        this.now(),
      );
      const isDual = this.isDualDisplayActive();
      if (isDual) {
        this.activeSessionId = null;
      }
      if (print) this.options.print?.requestSessionPrint(session.id, print.copies);
      if (isDual) {
        if (print) {
          this.backgroundPrint.track(session.id);
        } else {
          this.backgroundPrint.onNonPrintHandoff((id) => this.readPrintStatusForSession(id));
        }
        return this.stageQrStationPreparing(session);
      }
      return false;
    });
    this.emit();
    if (stagedQrPreparing) {
      this.emitQrStation();
    }
    void this.processCollage(session.id);
    return this.getSnapshot();
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
    this.deliveryModeBySession.delete(session.id);
    this.activeSessionId = null;
    this.backgroundPrint.clear();
    this.emit();
    return this.getSnapshot();
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
    if (!session || !isCancellableSessionState(session.state)) {
      return this.getSnapshot();
    }
    this.clearCountdown();
    this.camera.abortCapture?.();
    // Detach first so an in-flight capture cannot re-attach to a deleted session.
    this.activeSessionId = null;
    this.qrBySession.delete(sessionId);
    this.deliveryModeBySession.delete(sessionId);
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
    if (!this.isSessionCurrent(session.id)) return this.getSnapshot();
    const restarted = this.withoutPrintBroadcast(() => {
      const next = this.repository.startRetakeRound(session.id, this.now());
      this.options.print?.discardWaitingSessionPrint(session.id);
      return next;
    });
    this.beginCountdown(restarted);
    return this.getSnapshot();
  }

  async close(): Promise<void> {
    this.closed = true;
    this.unsubscribePrint?.();
    this.unsubscribePrint = null;
    this.clearCountdown();
    this.clearQrDismissTimer();
    this.backgroundPrint.clear();
    this.uploadQueue.stop();
    await Promise.all([this.camera.disconnect(), this.imageProcessor.close()]);
  }

  private isSessionCurrent(sessionId: string): boolean {
    return !this.closed && this.activeSessionId === sessionId;
  }

  private clearCountdown(): void {
    if (this.countdownTimer) {
      clearTimeout(this.countdownTimer);
      this.countdownTimer = null;
    }
    this.countdownEndsAt = null;
    this.countdownTotalSeconds = null;
  }

  private beginCountdown(session: StoredSession): void {
    if (session.state !== 'countdown')
      throw new AppError('state_conflict', 'Countdown cannot start now.');
    this.clearCountdown();
    const durationMs = resolveCountdownDurationMs(session, this.options.captureOverride);
    this.countdownTotalSeconds = Math.max(
      MIN_CAPTURE_COUNTDOWN_SECONDS,
      Math.min(MAX_CAPTURE_COUNTDOWN_SECONDS, Math.ceil(durationMs / 1_000)),
    );
    this.countdownEndsAt = this.now() + durationMs;
    this.countdownTimer = setTimeout(() => void this.captureNext(session.id), durationMs);
    this.emit();
  }

  private async captureNext(sessionId: string): Promise<void> {
    if (!this.isSessionCurrent(sessionId)) return;
    this.clearCountdown();
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
      if (!this.isSessionCurrent(sessionId)) return;
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
      if (session.state === 'countdown') {
        this.beginCountdown(session);
      } else {
        this.clearCountdown();
        this.emit();
      }
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
        throw new AppError('output_validation', 'The finished photo could not be validated.');
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
      // Printing never waits on delivery and delivery never waits on printing. A failure here
      // leaves the copies waiting; the print queue re-attaches them on its next start.
      this.withoutPrintBroadcast(() => {
        try {
          this.options.print?.attachSessionPhoto(sessionId, assetId);
        } catch {
          // Recovered by PrintService.recover().
        }
      });
      this.updateQrStationPreparing(sessionId, {
        collageUrl: mediaUrl(assetId),
        message: 'Preparing your QR code…',
      });
      this.uploadQueue.wake();
      this.syncMonitor1ForSession(sessionId, { emitWhenActive: true });
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
      const updatedSession = this.repository.getSession(sessionId);
      if (
        updatedSession &&
        this.qrStationState.status === 'preparing' &&
        this.qrStationState.sessionId === sessionId
      ) {
        this.presentQrStationError(updatedSession, null);
      }
      this.syncMonitor1ForSession(sessionId, { emitWhenActive: true });
    }
  }

  private handleUploadStarted(sessionId: string): void {
    this.updateQrStationPreparing(sessionId, { message: 'Uploading for your phone…' });
    this.emitIfActive(sessionId);
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
    const collage = this.repository
      .listCurrentAssets(sessionId)
      .find((asset) => asset.kind === 'collage');
    if (collage) {
      this.presentQrStationError(session, mediaUrl(collage.id));
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
      this.presentQrStationError(session, mediaUrl(collage.id));
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
    const deliveryMode: DeliveryMode = receipt.publicPageOrigin.startsWith('http://')
      ? 'offline'
      : 'cloud';
    this.deliveryModeBySession.set(sessionId, deliveryMode);
    const current = this.repository.requireSession(sessionId);
    if (current.state === 'ready') {
      this.transition(current, 'qr_ready', {}, this.now());
    }
    const sessionAssets = this.repository.listCurrentAssets(sessionId);
    const collage = sessionAssets.find((asset) => asset.kind === 'collage');
    const item = {
      sessionId,
      createdAt: session.createdAt,
      collageUrl: collage ? mediaUrl(collage.id) : null,
      qrImageUrl: qr.imageDataUrl,
      deliveryMode,
    };
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
      if (!this.isSessionCurrent(session.id)) return false;
      if (status.state !== 'ready' || !status.capabilities.stillCapture) {
        throw new AppError(
          status.code ?? 'camera_unavailable',
          status.operatorMessage || 'The camera is unavailable.',
        );
      }
      return true;
    } catch (error) {
      if (!this.isSessionCurrent(session.id)) return false;
      const safe = toSafeError(error);
      const current = this.repository.getSession(session.id);
      if (current?.state === 'countdown') {
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

  private readPrintStatusForSession(
    sessionId: string,
    session?: StoredSession | null,
  ): SessionPrintStatus | null {
    const current = session === undefined ? this.repository.getSession(sessionId) : session;
    return (
      this.options.print?.getSessionPrintStatus(sessionId, {
        sessionInterrupted: current?.state === 'interrupted',
      }) ?? null
    );
  }

  private projectPrintStatus(session: StoredSession): SessionPrintStatus | null {
    if (!canSessionHavePrintStatus(session.state)) return null;
    return this.readPrintStatusForSession(session.id, session);
  }

  private syncMonitor1ForSession(sessionId: string, opts: { emitWhenActive: boolean }): void {
    if (this.backgroundPrint.currentSessionId() === sessionId) {
      const nextBg = this.backgroundPrint.reconcile((id) => this.readPrintStatusForSession(id));
      if (
        !this.activeSessionId &&
        !isSameSessionPrintStatus(this.lastEmittedMonitor1PrintStatus, nextBg)
      ) {
        this.emit();
      }
    }
    if (opts.emitWhenActive && this.activeSessionId === sessionId) {
      this.emit();
    }
  }

  private withoutPrintBroadcast<T>(action: () => T): T {
    this.suppressingPrintBroadcast = true;
    try {
      return action();
    } finally {
      this.suppressingPrintBroadcast = false;
    }
  }

  private handlePrintChange(event: SessionPrintChangeEvent): void {
    if (this.closed || this.suppressingPrintBroadcast) return;

    if (this.backgroundPrint.handlesEvent(event)) {
      const nextBg = this.backgroundPrint.reconcile((id) => this.readPrintStatusForSession(id));
      if (
        !this.activeSessionId &&
        !isSameSessionPrintStatus(this.lastEmittedMonitor1PrintStatus, nextBg)
      ) {
        this.emit();
      }
    }

    if (
      this.activeSessionId &&
      (event.scope === 'health' || event.sessionId === this.activeSessionId)
    ) {
      const session = this.repository.getSession(this.activeSessionId);
      if (session && canSessionHavePrintStatus(session.state)) {
        const next = this.projectPrintStatus(session);
        if (!isSameSessionPrintStatus(this.lastEmittedMonitor1PrintStatus, next)) {
          this.emit();
        }
      }
    }

    const qrState = this.qrStationState;
    if (
      qrState.status !== 'idle' &&
      (event.scope === 'health' || event.sessionId === qrState.sessionId)
    ) {
      const next = this.readPrintStatusForSession(qrState.sessionId);
      if (!qrStationAllowsAutoDismiss(qrState)) {
        if (!isSameSessionPrintStatus(qrState.printStatus ?? null, next)) {
          this.qrStationState = { ...qrState, printStatus: next };
          this.emitQrStation();
        }
      } else {
        const wasActive = isSessionPrintActive(qrState.printStatus);
        const isNowActive = isSessionPrintActive(next);
        const needsTimerUpdate =
          wasActive !== isNowActive || (!isNowActive && qrState.expiresAt === null);
        if (!isSameSessionPrintStatus(qrState.printStatus ?? null, next) || needsTimerUpdate) {
          const duration =
            qrState.durationSeconds || this.repository.getSettings().qrDismissSeconds || 45;
          const expiresAt = needsTimerUpdate
            ? this.applyQrStationTimer(qrState.sessionId, duration, next)
            : qrState.expiresAt;
          this.qrStationState =
            qrState.status === 'active'
              ? { ...qrState, printStatus: next, expiresAt }
              : { ...qrState, printStatus: next, expiresAt };
          this.emitQrStation();
        }
      }
    }
  }

  private emitIfActive(sessionId: string): void {
    if (this.activeSessionId === sessionId) this.emit();
  }

  private emitQrStation(): void {
    for (const listener of this.qrListeners) listener(this.qrStationState);
  }

  private emit(): void {
    const snapshot = this.getSnapshot();
    this.lastEmittedMonitor1PrintStatus = snapshot.printStatus ?? null;
    for (const listener of this.listeners) listener(snapshot);
  }
}

function canSessionHavePrintStatus(state: SessionState): boolean {
  return (
    state === 'processing' ||
    state === 'pending_upload' ||
    state === 'uploading' ||
    state === 'ready' ||
    state === 'final' ||
    state === 'upload_failed' ||
    state === 'interrupted'
  );
}

function resolveSessionCapturePolicy(
  persisted: LocalSettings,
  override: CapturePolicyOverride | null | undefined,
): CaptureSettings {
  return {
    countdownSeconds: persisted.captureCountdownSeconds,
    reviewMode: override?.reviewMode ?? persisted.captureReviewMode,
  };
}

function resolveCountdownDurationMs(
  session: StoredSession,
  override: CapturePolicyOverride | null | undefined,
): number {
  return override?.countdownMs ?? session.captureCountdownSeconds * 1_000;
}

function attractSnapshot(
  cameraPreviewEnabled: boolean,
  requiredShotCount = 3,
  printStatus: SessionPrintStatus | null = null,
): BoothSnapshot {
  return {
    screen: 'attract',
    state: null,
    sessionId: null,
    shotNumber: null,
    captureCount: 0,
    requiredShotCount,
    countdownEndsAt: null,
    countdownTotalSeconds: null,
    cameraPreviewEnabled,
    media: { captureUrls: [], collageUrl: null, qrImageUrl: null },
    controls: {
      canStart: true,
      canAcceptShot: false,
      canRetakeShot: false,
      canRetakeAll: false,
      canAcceptPhotos: false,
      canRetryUpload: false,
      canFinishOffline: false,
      canFinish: false,
    },
    errorCode: null,
    message: null,
    printStatus,
  };
}

function screenFor(state: SessionState, qrReady: boolean): BoothSnapshot['screen'] {
  if (state === 'countdown') return 'countdown';
  if (state === 'capturing') return 'capturing';
  if (state === 'shot_review') return 'shot_review';
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
