import type {
  CameraAdapterKind,
  CameraResolution,
  FrameLayout,
  SessionState,
  UploadJobState,
} from '@grace-booth/shared';
import { FrameLayoutSchema, SessionStateSchema, UploadJobStateSchema } from '@grace-booth/shared';

import { AppError } from '../errors.js';
import { reduceSessionState } from '../workflow/session-state-machine.js';
import type { BoothDatabase } from './database.js';

type RawSettingsRow = {
  passcode_hash: Buffer | null;
  passcode_salt: Buffer | null;
  scrypt_version: number;
  scrypt_n: number;
  scrypt_r: number;
  scrypt_p: number;
  scrypt_key_length: number;
  active_frame_id: string | null;
  collage_2_frame_id: string | null;
  google_forms_url: string | null;
  local_retention_days: number;
  cloud_retention_days: number;
  lan_enabled: number;
  lan_bind_host: string;
  lan_port: number;
  lan_tls_secret_ref: string | null;
  lan_certificate_fingerprint: string | null;
  camera_adapter: string | null;
  camera_device_id: string | null;
  camera_resolution: string;
  supabase_url: string | null;
  supabase_publishable_key: string | null;
  revision: number;
  created_at: number;
  updated_at: number;
};

export type LocalSettings = {
  passcodeHash: Buffer | null;
  passcodeSalt: Buffer | null;
  scryptVersion: 1;
  scryptN: number;
  scryptR: number;
  scryptP: number;
  scryptKeyLength: number;
  activeFrameId: string | null;
  collage2FrameId: string | null;
  googleFormsUrl: string | null;
  localRetentionDays: 60;
  cloudRetentionDays: 30;
  lanEnabled: boolean;
  lanBindHost: string;
  lanPort: number;
  lanTlsSecretRef: string | null;
  lanCertificateFingerprint: string | null;
  cameraAdapter: CameraAdapterKind;
  cameraDeviceId: string | null;
  cameraResolution: CameraResolution;
  supabaseUrl: string | null;
  supabasePublishableKey: string | null;
  revision: number;
  createdAt: number;
  updatedAt: number;
};

export type StoredFrame = {
  id: string;
  name: string;
  encryptedPath: string;
  width: number;
  height: number;
  byteSize: number;
  sha256: string;
  revision: number;
  sortOrder: number | null;
  createdAt: number;
  updatedAt: number;
  slots: FrameLayout;
};

export type StoredAsset = {
  id: string;
  sessionId: string;
  kind: 'capture' | 'collage';
  retakeRound: number;
  shotNumber: number | null;
  encryptedPath: string;
  contentType: 'image/jpeg';
  width: number;
  height: number;
  byteSize: number;
  sha256: string;
  createdAt: number;
  cleanupState: 'active' | 'tombstoning' | 'tombstoned';
  tombstonePath: string | null;
};

export type StoredSession = {
  id: string;
  state: SessionState;
  captureRound: number;
  captureCount: number;
  selectedOption: number;
  selectedFrameId: string | null;
  collageAssetId: string | null;
  cloudPhotoSessionId: string | null;
  publicSecretRef: string | null;
  readyAt: number | null;
  expiresAt: number | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
  retentionAnchorAt: number | null;
  cleanupState: 'active' | 'tombstoning';
  cleanupStartedAt: number | null;
};

export type StoredUploadJob = {
  id: string;
  sessionId: string;
  state: UploadJobState;
  attemptCount: number;
  lifetimeFailureCount: number;
  automaticRetryIndex: number;
  manualRetryCycle: number;
  nextAttemptAt: number | null;
  leaseOwner: string | null;
  leaseUntil: number | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  createdAt: number;
  updatedAt: number;
};

export type NewAsset = {
  id: string;
  sessionId: string;
  kind: 'capture' | 'collage';
  retakeRound: number;
  shotNumber: number | null;
  encryptedPath: string;
  width: number;
  height: number;
  byteSize: number;
  sha256: string;
  createdAt: number;
};

const SETTINGS_SELECT = `
  SELECT passcode_hash, passcode_salt, scrypt_version, scrypt_n, scrypt_r, scrypt_p, scrypt_key_length,
    active_frame_id, collage_2_frame_id, google_forms_url, local_retention_days, cloud_retention_days,
    lan_enabled, lan_bind_host, lan_port, lan_tls_secret_ref,
    lan_certificate_fingerprint, camera_adapter, camera_device_id, camera_resolution,
    revision, created_at, updated_at
  FROM settings WHERE id = 1
`;

const SESSION_SELECT = `
  SELECT id, state, capture_round, capture_count, selected_option, selected_frame_id,
    collage_asset_id, cloud_photo_session_id, public_secret_ref, ready_at, expires_at,
    last_error_code, last_error_message, created_at, updated_at, completed_at,
    retention_anchor_at, cleanup_state, cleanup_started_at
  FROM sessions
`;

const JOB_SELECT = `
  SELECT id, session_id, state, attempt_count, lifetime_failure_count, automatic_retry_index,
    manual_retry_cycle, next_attempt_at, lease_owner, lease_until,
    last_error_code, last_error_message, created_at, updated_at
  FROM upload_jobs
`;

export class LocalRepository {
  constructor(private readonly database: BoothDatabase) {}

  getSettings(): LocalSettings {
    const row = this.database.raw.prepare(SETTINGS_SELECT).get() as RawSettingsRow | undefined;
    if (!row) throw new AppError('settings_missing', 'Local settings could not be loaded.');
    return mapSettings(row);
  }

  setPasscode(
    passcodeHash: Buffer,
    passcodeSalt: Buffer,
    parameters: { n: number; r: number; p: number; keyLength: number },
    operation: 'passcode_bootstrap' | 'passcode_change',
    now = Date.now(),
  ): void {
    this.database.raw.transaction(() => {
      const bootstrapGuard = operation === 'passcode_bootstrap' ? ' AND passcode_hash IS NULL' : '';
      const result = this.database.raw
        .prepare(
          `UPDATE settings SET passcode_hash = ?, passcode_salt = ?, scrypt_version = 1, scrypt_n = ?,
            scrypt_r = ?, scrypt_p = ?, scrypt_key_length = ?, revision = revision + 1,
            updated_at = ? WHERE id = 1${bootstrapGuard}`,
        )
        .run(
          passcodeHash,
          passcodeSalt,
          parameters.n,
          parameters.r,
          parameters.p,
          parameters.keyLength,
          now,
        );
      if (result.changes !== 1) {
        throw new AppError(
          'passcode_conflict',
          'The passcode changed elsewhere. Please try again.',
        );
      }
      this.recordAudit(operation, 'success', null, now);
    })();
  }

  updateSettings(
    input: {
      googleFormsUrl: string | null;
      lanEnabled: boolean;
      lanBindHost: string;
      lanPort: number;
      expectedRevision: number;
    },
    now = Date.now(),
  ): LocalSettings {
    const result = this.database.raw
      .prepare(
        `UPDATE settings SET google_forms_url = ?, lan_enabled = ?, lan_bind_host = ?,
          lan_port = ?, revision = revision + 1, updated_at = ?
        WHERE id = 1 AND revision = ?`,
      )
      .run(
        input.googleFormsUrl,
        input.lanEnabled ? 1 : 0,
        input.lanBindHost,
        input.lanPort,
        now,
        input.expectedRevision,
      );
    if (result.changes !== 1) {
      throw new AppError('settings_conflict', 'Settings changed elsewhere. Reload and try again.');
    }
    this.recordAudit('settings_change', 'success', null, now);
    return this.getSettings();
  }

  setLanCertificate(secretRef: string, fingerprint: string, now = Date.now()): LocalSettings {
    this.database.raw
      .prepare(
        `UPDATE settings SET lan_tls_secret_ref = ?, lan_certificate_fingerprint = ?,
          revision = revision + 1, updated_at = ? WHERE id = 1`,
      )
      .run(secretRef, fingerprint, now);
    this.recordAudit('settings_change', 'success', 'lan_certificate_updated', now);
    return this.getSettings();
  }

  setCameraSettings(
    adapter: CameraAdapterKind,
    deviceId: string | null = null,
    resolution: CameraResolution = '1080p',
    now = Date.now(),
  ): LocalSettings {
    this.database.raw
      .prepare(
        `UPDATE settings SET camera_adapter = ?, camera_device_id = ?, camera_resolution = ?,
          revision = revision + 1, updated_at = ? WHERE id = 1`,
      )
      .run(adapter, deviceId, resolution, now);
    this.recordAudit('settings_change', 'success', 'camera_adapter_updated', now);
    return this.getSettings();
  }

  setCloudSettings(
    supabaseUrl: string | null,
    supabasePublishableKey: string | null,
    now = Date.now(),
  ): LocalSettings {
    this.database.raw
      .prepare(
        `UPDATE settings SET supabase_url = ?, supabase_publishable_key = ?,
          revision = revision + 1, updated_at = ? WHERE id = 1`,
      )
      .run(supabaseUrl, supabasePublishableKey, now);
    this.recordAudit('settings_change', 'success', 'cloud_settings_updated', now);
    return this.getSettings();
  }

  addFrame(frame: Omit<StoredFrame, 'slots'>, slots: FrameLayout, optionIndex: 1 | 2 = 1): void {
    const validatedSlots = FrameLayoutSchema.parse(slots);
    const targetColumn = optionIndex === 2 ? 'collage_2_frame_id' : 'active_frame_id';
    this.database.raw.transaction(() => {
      this.insertFrameRow(frame, validatedSlots);
      this.database.raw
        .prepare(
          `UPDATE settings SET ${targetColumn} = ?, revision = revision + 1, updated_at = ?
          WHERE id = 1`,
        )
        .run(frame.id, frame.updatedAt);
      this.recordAudit('frame_change', 'success', 'frame_added', frame.updatedAt);
    })();
  }

  /** Appends a frame to the operator-managed library without changing collage pointers. */
  insertLibraryFrame(frame: Omit<StoredFrame, 'slots'>, slots: FrameLayout): void {
    const validatedSlots = FrameLayoutSchema.parse(slots);
    this.database.raw.transaction(() => {
      this.insertFrameRow(frame, validatedSlots);
      if (this.getSettings().activeFrameId === null) {
        // The first frame in an empty library becomes the default active frame.
        this.database.raw
          .prepare('UPDATE settings SET active_frame_id = ?, updated_at = ? WHERE id = 1')
          .run(frame.id, frame.updatedAt);
      }
      this.recordAudit('frame_change', 'success', 'frame_added', frame.updatedAt);
    })();
  }

  listFrames(): StoredFrame[] {
    return loadFrameRows(
      this.database,
      'ORDER BY (sort_order IS NULL), sort_order, created_at, id',
      [],
    );
  }

  nextSortOrder(): number {
    const row = this.database.raw
      .prepare('SELECT MAX(sort_order) AS max_order FROM frames')
      .get() as { max_order: number | null };
    return (row.max_order ?? 0) + 1;
  }

  setFrameSortOrder(frameId: string, sortOrder: number | null, now = Date.now()): void {
    const result = this.database.raw
      .prepare('UPDATE frames SET sort_order = ?, updated_at = ? WHERE id = ?')
      .run(sortOrder, now, frameId);
    if (result.changes !== 1)
      throw new AppError('frame_missing', 'The selected frame no longer exists.');
  }

  swapFrameSortOrders(firstId: string, secondId: string, now = Date.now()): void {
    this.database.raw.transaction(() => {
      const first = this.getFrame(firstId);
      const second = this.getFrame(secondId);
      if (!first || !second) {
        throw new AppError('frame_missing', 'The selected frame no longer exists.');
      }
      this.setFrameSortOrder(firstId, second.sortOrder, now);
      this.setFrameSortOrder(secondId, first.sortOrder, now);
    })();
  }

  deleteFrameRow(frameId: string): void {
    this.database.raw.prepare('DELETE FROM frames WHERE id = ?').run(frameId);
  }

  countSessionsReferencingFrame(frameId: string): number {
    const row = this.database.raw
      .prepare('SELECT COUNT(*) AS n FROM sessions WHERE selected_frame_id = ?')
      .get(frameId) as { n: number };
    return row.n;
  }

  repointFramePointer(frameId: string, replacementId: string | null, now = Date.now()): void {
    this.database.raw
      .prepare(
        `UPDATE settings SET
          active_frame_id = CASE WHEN active_frame_id = ? THEN ? ELSE active_frame_id END,
          collage_2_frame_id = CASE WHEN collage_2_frame_id = ? THEN ? ELSE collage_2_frame_id END,
          revision = revision + 1, updated_at = ?
        WHERE id = 1`,
      )
      .run(frameId, replacementId, frameId, replacementId, now);
  }

  setCollageFrameId(optionIndex: 1 | 2, frameId: string, now = Date.now()): LocalSettings {
    const targetColumn = optionIndex === 2 ? 'collage_2_frame_id' : 'active_frame_id';
    this.database.raw
      .prepare(
        `UPDATE settings SET ${targetColumn} = ?, revision = revision + 1, updated_at = ? WHERE id = 1`,
      )
      .run(frameId, now);
    this.recordAudit('frame_change', 'success', 'frame_assigned', now);
    return this.getSettings();
  }

  getFrame(frameId: string): StoredFrame | null {
    return loadFrameRows(this.database, 'WHERE id = ?', [frameId])[0] ?? null;
  }

  getActiveFrame(): StoredFrame | null {
    const { activeFrameId } = this.getSettings();
    return activeFrameId ? this.getFrame(activeFrameId) : null;
  }

  getFrameOptions(): [StoredFrame | null, StoredFrame | null] {
    const { activeFrameId, collage2FrameId } = this.getSettings();
    const frame1 = activeFrameId ? this.getFrame(activeFrameId) : null;
    const frame2 = collage2FrameId ? this.getFrame(collage2FrameId) : null;
    return [frame1, frame2];
  }

  updateFrameLayout(
    frameId: string,
    slots: FrameLayout,
    expectedRevision: number,
    name?: string,
    now = Date.now(),
  ): StoredFrame {
    const validatedSlots = FrameLayoutSchema.parse(slots);
    this.database.raw.transaction(() => {
      const result = this.database.raw
        .prepare(
          'UPDATE frames SET revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ?',
        )
        .run(now, frameId, expectedRevision);
      if (result.changes !== 1) {
        throw new AppError('frame_conflict', 'The frame changed elsewhere. Reload and try again.');
      }
      if (name !== undefined) {
        const withName = this.database.raw
          .prepare('UPDATE frames SET name = ? WHERE id = ?')
          .run(name, frameId);
        if (withName.changes !== 1) {
          throw new AppError('frame_missing', 'The selected frame no longer exists.');
        }
      }
      this.database.raw.prepare('DELETE FROM frame_slots WHERE frame_id = ?').run(frameId);
      this.insertFrameSlots(frameId, validatedSlots);
      this.recordAudit('frame_change', 'success', 'layout_updated', now);
    })();
    const frame = this.getFrame(frameId);
    if (!frame) throw new AppError('frame_missing', 'The selected frame no longer exists.');
    return frame;
  }

  createSession(sessionId: string, now = Date.now()): StoredSession {
    this.database.raw
      .prepare(
        `INSERT INTO sessions
          (id, state, capture_round, capture_count, retention_anchor_at, created_at, updated_at)
        VALUES (?, 'countdown', 0, 0, ?, ?, ?)`,
      )
      .run(sessionId, now, now, now);
    return this.requireSession(sessionId);
  }

  getSession(sessionId: string): StoredSession | null {
    const row = this.database.raw.prepare(`${SESSION_SELECT} WHERE id = ?`).get(sessionId);
    return row ? mapSession(row as Record<string, unknown>) : null;
  }

  listSessionsWithPublicSecret(limit = 100): StoredSession[] {
    return this.database.raw
      .prepare(
        `${SESSION_SELECT} WHERE public_secret_ref IS NOT NULL ORDER BY created_at DESC LIMIT ?`,
      )
      .all(limit)
      .map((row) => mapSession(row as Record<string, unknown>));
  }

  listRecentSessionsWithCollage(limit = 20): StoredSession[] {
    return this.database.raw
      .prepare(
        `${SESSION_SELECT} WHERE collage_asset_id IS NOT NULL
        ORDER BY COALESCE(completed_at, updated_at) DESC LIMIT ?`,
      )
      .all(Math.max(1, Math.min(50, limit)))
      .map((row) => mapSession(row as Record<string, unknown>));
  }

  requireSession(sessionId: string): StoredSession {
    const session = this.getSession(sessionId);
    if (!session) throw new AppError('session_missing', 'The photo session could not be found.');
    return session;
  }

  getLatestIncompleteSession(): StoredSession | null {
    const row = this.database.raw
      .prepare(
        `${SESSION_SELECT}
        WHERE state <> 'attract'
        ORDER BY updated_at DESC LIMIT 1`,
      )
      .get();
    return row ? mapSession(row as Record<string, unknown>) : null;
  }

  transitionSession(
    sessionId: string,
    fromStates: readonly SessionState[],
    toState: SessionState,
    patch: {
      captureCount?: number;
      selectedOption?: number;
      selectedFrameId?: string | null;
      collageAssetId?: string | null;
      cloudPhotoSessionId?: string | null;
      publicSecretRef?: string | null;
      readyAt?: number | null;
      expiresAt?: number | null;
      lastErrorCode?: string | null;
      lastErrorMessage?: string | null;
      completedAt?: number | null;
      retentionAnchorAt?: number | null;
    } = {},
    now = Date.now(),
  ): StoredSession {
    SessionStateSchema.parse(toState);
    if (fromStates.length === 0) throw new Error('At least one source state is required');
    const assignments = ['state = ?', 'updated_at = ?'];
    const values: unknown[] = [toState, now];
    const columns: Record<keyof typeof patch, string> = {
      captureCount: 'capture_count',
      selectedOption: 'selected_option',
      selectedFrameId: 'selected_frame_id',
      collageAssetId: 'collage_asset_id',
      cloudPhotoSessionId: 'cloud_photo_session_id',
      publicSecretRef: 'public_secret_ref',
      readyAt: 'ready_at',
      expiresAt: 'expires_at',
      lastErrorCode: 'last_error_code',
      lastErrorMessage: 'last_error_message',
      completedAt: 'completed_at',
      retentionAnchorAt: 'retention_anchor_at',
    };
    for (const key of Object.keys(patch) as (keyof typeof patch)[]) {
      assignments.push(`${columns[key]} = ?`);
      values.push(patch[key]);
    }
    const placeholders = fromStates.map(() => '?').join(', ');
    values.push(sessionId, ...fromStates);
    const result = this.database.raw
      .prepare(
        `UPDATE sessions SET ${assignments.join(', ')}
        WHERE id = ? AND state IN (${placeholders})`,
      )
      .run(...values);
    if (result.changes !== 1) {
      throw new AppError(
        'state_conflict',
        'The photo session changed unexpectedly. Please try again.',
      );
    }
    return this.requireSession(sessionId);
  }

  addCapture(asset: NewAsset, now = Date.now()): StoredSession {
    return this.database.raw.transaction(() => {
      const current = this.requireSession(asset.sessionId);
      if (current.state !== 'capturing' || asset.retakeRound !== current.captureRound) {
        throw new AppError('state_conflict', 'The capture round changed unexpectedly.');
      }
      const expectedState = reduceSessionState(
        current.state,
        current.captureCount < 2 ? 'capture_more' : 'capture_complete',
      );
      this.insertAsset(asset);
      const result = this.database.raw
        .prepare(
          `UPDATE sessions SET capture_count = capture_count + 1, state = 'countdown',
            updated_at = ? WHERE id = ? AND state = 'capturing' AND capture_count < 2`,
        )
        .run(now, asset.sessionId);
      if (result.changes === 0) {
        const finalResult = this.database.raw
          .prepare(
            `UPDATE sessions SET capture_count = capture_count + 1, state = 'review',
              updated_at = ? WHERE id = ? AND state = 'capturing' AND capture_count = 2`,
          )
          .run(now, asset.sessionId);
        if (finalResult.changes !== 1) {
          throw new AppError('state_conflict', 'The capture could not be recorded safely.');
        }
      }
      const saved = this.requireSession(asset.sessionId);
      if (saved.state !== expectedState)
        throw new AppError('state_conflict', 'Capture state is invalid.');
      return saved;
    })();
  }

  startRetakeRound(sessionId: string, now = Date.now()): StoredSession {
    return this.database.raw.transaction(() => {
      const current = this.requireSession(sessionId);
      const event = current.state === 'review' ? 'retake_all' : 'operator_restart';
      const next = reduceSessionState(current.state, event);
      const result = this.database.raw
        .prepare(
          `UPDATE sessions SET state = 'countdown', capture_round = capture_round + 1,
            capture_count = 0, selected_option = 1, selected_frame_id = NULL,
            last_error_code = NULL, last_error_message = NULL, updated_at = ?
          WHERE id = ? AND state IN ('review', 'camera_error', 'interrupted')`,
        )
        .run(now, sessionId);
      if (result.changes !== 1)
        throw new AppError('state_conflict', 'Retake is not available now.');
      const saved = this.requireSession(sessionId);
      if (saved.state !== next) throw new AppError('state_conflict', 'Retake state is invalid.');
      return saved;
    })();
  }

  saveCollageAndQueue(asset: NewAsset, jobId: string, now = Date.now()): StoredUploadJob {
    return this.database.raw.transaction(() => {
      const current = this.requireSession(asset.sessionId);
      const next = reduceSessionState(current.state, 'processing_complete');
      this.insertAsset(asset);
      const transition = this.database.raw
        .prepare(
          `UPDATE sessions SET state = 'pending_upload', collage_asset_id = ?, updated_at = ?
          WHERE id = ? AND state = 'processing'`,
        )
        .run(asset.id, now, asset.sessionId);
      if (transition.changes !== 1) {
        throw new AppError('state_conflict', 'The collage could not be queued safely.');
      }
      if (next !== 'pending_upload')
        throw new AppError('state_conflict', 'Upload state is invalid.');
      this.database.raw
        .prepare(
          `INSERT INTO upload_jobs
            (id, session_id, state, attempt_count, lifetime_failure_count,
              automatic_retry_index, manual_retry_cycle, created_at, updated_at)
          VALUES (?, ?, 'queued', 0, 0, 0, 0, ?, ?)`,
        )
        .run(jobId, asset.sessionId, now, now);
      return this.requireUploadJob(jobId);
    })();
  }

  listAssets(sessionId: string): StoredAsset[] {
    return this.database.raw
      .prepare(
        `SELECT id, session_id, kind, retake_round, shot_number, encrypted_path, content_type,
          width, height, byte_size, sha256, created_at, cleanup_state, tombstone_path
        FROM session_assets WHERE session_id = ? ORDER BY kind, retake_round, shot_number`,
      )
      .all(sessionId)
      .map((row) => mapAsset(row as Record<string, unknown>));
  }

  listCurrentAssets(sessionId: string): StoredAsset[] {
    return this.database.raw
      .prepare(
        `SELECT a.id, a.session_id, a.kind, a.retake_round, a.shot_number,
          a.encrypted_path, a.content_type, a.width, a.height, a.byte_size,
          a.sha256, a.created_at, a.cleanup_state, a.tombstone_path
        FROM session_assets a
        JOIN sessions s ON s.id = a.session_id
        WHERE a.session_id = ?
          AND (a.kind = 'collage' OR a.retake_round = s.capture_round)
          AND a.cleanup_state = 'active'
        ORDER BY a.kind, a.retake_round, a.shot_number`,
      )
      .all(sessionId)
      .map((row) => mapAsset(row as Record<string, unknown>));
  }

  getAsset(assetId: string): StoredAsset | null {
    const row = this.database.raw
      .prepare(
        `SELECT id, session_id, kind, retake_round, shot_number, encrypted_path, content_type,
          width, height, byte_size, sha256, created_at, cleanup_state, tombstone_path
        FROM session_assets WHERE id = ?`,
      )
      .get(assetId);
    return row ? mapAsset(row as Record<string, unknown>) : null;
  }

  getUploadJob(jobId: string): StoredUploadJob | null {
    const row = this.database.raw.prepare(`${JOB_SELECT} WHERE id = ?`).get(jobId);
    return row ? mapUploadJob(row as Record<string, unknown>) : null;
  }

  requireUploadJob(jobId: string): StoredUploadJob {
    const job = this.getUploadJob(jobId);
    if (!job) throw new AppError('upload_job_missing', 'The upload job could not be found.');
    return job;
  }

  getUploadJobForSession(sessionId: string): StoredUploadJob | null {
    const row = this.database.raw.prepare(`${JOB_SELECT} WHERE session_id = ?`).get(sessionId);
    return row ? mapUploadJob(row as Record<string, unknown>) : null;
  }

  listUploadJobs(limit = 50, beforeUpdatedAt: number | null = null): StoredUploadJob[] {
    const safeLimit = Math.max(1, Math.min(100, limit));
    const rowset =
      beforeUpdatedAt === null
        ? this.database.raw
            .prepare(`${JOB_SELECT} ORDER BY updated_at DESC, id DESC LIMIT ?`)
            .all(safeLimit)
        : this.database.raw
            .prepare(`${JOB_SELECT} WHERE updated_at < ? ORDER BY updated_at DESC, id DESC LIMIT ?`)
            .all(beforeUpdatedAt, safeLimit);
    return rowset.map((row) => mapUploadJob(row as Record<string, unknown>));
  }

  claimNextDueUpload(
    leaseOwner: string,
    now = Date.now(),
    leaseDurationMs = 5 * 60 * 1_000,
  ): StoredUploadJob | null {
    return this.database.raw.transaction(() => {
      const row = this.database.raw
        .prepare(
          `${JOB_SELECT}
          WHERE state IN ('queued', 'retry_wait')
            AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
          ORDER BY created_at ASC LIMIT 1`,
        )
        .get(now);
      if (!row) return null;
      const job = mapUploadJob(row as Record<string, unknown>);
      const session = this.requireSession(job.sessionId);
      const nextSessionState = reduceSessionState(session.state, 'upload_begin');
      const result = this.database.raw
        .prepare(
          `UPDATE upload_jobs SET state = 'creating_upload', lease_owner = ?, lease_until = ?,
            next_attempt_at = NULL, updated_at = ? WHERE id = ? AND state = ?`,
        )
        .run(leaseOwner, now + leaseDurationMs, now, job.id, job.state);
      if (result.changes !== 1) return null;
      const sessionResult = this.database.raw
        .prepare(
          `UPDATE sessions SET state = ?, updated_at = ?
          WHERE id = ? AND state = 'pending_upload'`,
        )
        .run(nextSessionState, now, job.sessionId);
      if (sessionResult.changes !== 1) {
        throw new AppError('state_conflict', 'The upload session could not be claimed safely.');
      }
      return this.requireUploadJob(job.id);
    })();
  }

  beginUploadAttempt(jobId: string, leaseOwner: string, now = Date.now()): StoredUploadJob {
    const result = this.database.raw
      .prepare(
        `UPDATE upload_jobs SET attempt_count = attempt_count + 1, updated_at = ?
        WHERE id = ? AND lease_owner = ? AND lease_until > ? AND state = 'creating_upload'`,
      )
      .run(now, jobId, leaseOwner, now);
    if (result.changes !== 1)
      throw new AppError('upload_lease_lost', 'The upload lease expired.', true);
    return this.requireUploadJob(jobId);
  }

  continueUploadAttempt(jobId: string, leaseOwner: string, now = Date.now()): StoredUploadJob {
    const result = this.database.raw
      .prepare(
        `UPDATE upload_jobs SET updated_at = ?
        WHERE id = ? AND lease_owner = ? AND lease_until > ?
          AND state = 'creating_upload' AND last_error_code = 'signed_upload_expired'`,
      )
      .run(now, jobId, leaseOwner, now);
    if (result.changes !== 1) {
      throw new AppError('upload_lease_lost', 'The upload lease expired.', true);
    }
    return this.requireUploadJob(jobId);
  }

  getNextUploadDueAt(): number | null {
    const row = this.database.raw
      .prepare(
        `SELECT MIN(COALESCE(next_attempt_at, 0)) AS due_at FROM upload_jobs
        WHERE state IN ('queued', 'retry_wait')`,
      )
      .get() as { due_at: number | null };
    return row.due_at;
  }

  resumeAuthenticationPausedUploads(now = Date.now()): number {
    return this.database.raw
      .prepare(
        `UPDATE upload_jobs SET next_attempt_at = NULL, updated_at = ?
        WHERE state = 'queued' AND last_error_code IN (
          'cloud_auth_required', 'cloud_auth_expired', 'cloud_unconfigured'
        )`,
      )
      .run(now).changes;
  }

  updateUploadJob(
    jobId: string,
    state: UploadJobState,
    patch: {
      automaticRetryIndex?: number;
      nextAttemptAt?: number | null;
      lastErrorCode?: string | null;
      lastErrorMessage?: string | null;
      leaseOwner?: string | null;
      leaseUntil?: number | null;
    } = {},
    now = Date.now(),
  ): StoredUploadJob {
    UploadJobStateSchema.parse(state);
    const assignments = ['state = ?', 'updated_at = ?'];
    const values: unknown[] = [state, now];
    const columns: Record<keyof typeof patch, string> = {
      automaticRetryIndex: 'automatic_retry_index',
      nextAttemptAt: 'next_attempt_at',
      lastErrorCode: 'last_error_code',
      lastErrorMessage: 'last_error_message',
      leaseOwner: 'lease_owner',
      leaseUntil: 'lease_until',
    };
    for (const key of Object.keys(patch) as (keyof typeof patch)[]) {
      assignments.push(`${columns[key]} = ?`);
      values.push(patch[key]);
    }
    values.push(jobId);
    const result = this.database.raw
      .prepare(`UPDATE upload_jobs SET ${assignments.join(', ')} WHERE id = ?`)
      .run(...values);
    if (result.changes !== 1) throw new AppError('upload_job_missing', 'Upload job not found.');
    return this.requireUploadJob(jobId);
  }

  attachCloudUpload(
    sessionId: string,
    cloudPhotoSessionId: string,
    publicSecretRef: string,
    now = Date.now(),
  ): StoredSession {
    const result = this.database.raw
      .prepare(
        `UPDATE sessions SET cloud_photo_session_id = ?, public_secret_ref = ?, updated_at = ?
        WHERE id = ? AND state = 'uploading'
          AND (cloud_photo_session_id IS NULL OR cloud_photo_session_id = ?)`,
      )
      .run(cloudPhotoSessionId, publicSecretRef, now, sessionId, cloudPhotoSessionId);
    if (result.changes !== 1) {
      throw new AppError('state_conflict', 'Cloud upload details could not be saved safely.');
    }
    return this.requireSession(sessionId);
  }

  retryUpload(jobId: string, now = Date.now()): StoredUploadJob {
    return this.database.raw.transaction(() => {
      const job = this.requireUploadJob(jobId);
      if (job.state !== 'failed') {
        throw new AppError('upload_not_retryable', 'This upload does not need a manual retry.');
      }
      const session = this.requireSession(job.sessionId);
      const nextSessionState = reduceSessionState(session.state, 'resume_upload');
      this.database.raw
        .prepare(
          `UPDATE upload_jobs SET state = 'queued', automatic_retry_index = 0,
            manual_retry_cycle = manual_retry_cycle + 1,
            next_attempt_at = NULL, last_error_code = NULL, last_error_message = NULL,
            lease_owner = NULL, lease_until = NULL,
            updated_at = ? WHERE id = ?`,
        )
        .run(now, jobId);
      this.database.raw
        .prepare(
          `UPDATE sessions SET state = ?, last_error_code = NULL,
            last_error_message = NULL, updated_at = ? WHERE id = ? AND state = 'upload_failed'`,
        )
        .run(nextSessionState, now, job.sessionId);
      this.recordAudit('upload_retry', 'success', null, now);
      return this.requireUploadJob(jobId);
    })();
  }

  markUploadReady(
    jobId: string,
    input: {
      cloudPhotoSessionId: string;
      publicSecretRef: string;
      readyAt: number;
      expiresAt: number;
    },
    now = Date.now(),
  ): StoredSession {
    return this.database.raw.transaction(() => {
      const job = this.requireUploadJob(jobId);
      const session = this.requireSession(job.sessionId);
      const nextSessionState = reduceSessionState(session.state, 'confirmation_ready');
      this.database.raw
        .prepare(
          `UPDATE upload_jobs SET state = 'succeeded', next_attempt_at = NULL,
            last_error_code = NULL, last_error_message = NULL,
            lease_owner = NULL, lease_until = NULL, updated_at = ? WHERE id = ?`,
        )
        .run(now, jobId);
      const result = this.database.raw
        .prepare(
          `UPDATE sessions SET state = ?, cloud_photo_session_id = ?, public_secret_ref = ?,
            ready_at = ?, expires_at = ?, last_error_code = NULL, last_error_message = NULL,
            updated_at = ? WHERE id = ? AND state = 'uploading'`,
        )
        .run(
          nextSessionState,
          input.cloudPhotoSessionId,
          input.publicSecretRef,
          input.readyAt,
          input.expiresAt,
          now,
          job.sessionId,
        );
      if (result.changes !== 1)
        throw new AppError('state_conflict', 'Ready state could not be saved.');
      return this.requireSession(job.sessionId);
    })();
  }

  markUploadFailure(
    jobId: string,
    input: {
      retryAt: number | null;
      retryIndex: number;
      errorCode: string;
      errorMessage: string;
    },
    now = Date.now(),
  ): StoredUploadJob {
    return this.database.raw.transaction(() => {
      const job = this.requireUploadJob(jobId);
      const terminal = input.retryAt === null;
      const session = this.requireSession(job.sessionId);
      const nextSessionState = reduceSessionState(
        session.state,
        terminal ? 'upload_failed' : 'upload_retry_wait',
      );
      const state: UploadJobState = terminal ? 'failed' : 'retry_wait';
      this.updateUploadJob(
        jobId,
        state,
        {
          automaticRetryIndex: input.retryIndex,
          nextAttemptAt: input.retryAt,
          lastErrorCode: input.errorCode,
          lastErrorMessage: input.errorMessage,
          leaseOwner: null,
          leaseUntil: null,
        },
        now,
      );
      this.database.raw
        .prepare(
          `UPDATE upload_jobs SET lifetime_failure_count = lifetime_failure_count + 1
          WHERE id = ?`,
        )
        .run(jobId);
      this.database.raw
        .prepare(
          `UPDATE sessions SET state = ?, last_error_code = ?, last_error_message = ?,
            updated_at = ? WHERE id = ? AND state = 'uploading'`,
        )
        .run(nextSessionState, input.errorCode, input.errorMessage, now, job.sessionId);
      return this.requireUploadJob(jobId);
    })();
  }

  requeueUploadWithoutFailure(
    jobId: string,
    leaseOwner: string,
    attemptStarted: boolean,
    nextAttemptAt: number,
    errorCode: string,
    errorMessage: string,
    now = Date.now(),
  ): StoredUploadJob {
    return this.database.raw.transaction(() => {
      const job = this.requireUploadJob(jobId);
      const result = this.database.raw
        .prepare(
          `UPDATE upload_jobs SET state = 'queued',
            attempt_count = MAX(0, attempt_count - ?), next_attempt_at = ?,
            lease_owner = NULL, lease_until = NULL,
            last_error_code = ?, last_error_message = ?, updated_at = ?
          WHERE id = ? AND lease_owner = ?`,
        )
        .run(
          attemptStarted ? 1 : 0,
          nextAttemptAt,
          errorCode,
          errorMessage,
          now,
          jobId,
          leaseOwner,
        );
      if (result.changes !== 1)
        throw new AppError('upload_lease_lost', 'The upload lease expired.', true);
      this.database.raw
        .prepare(
          `UPDATE sessions SET state = 'pending_upload', updated_at = ?
          WHERE id = ? AND state = 'uploading'`,
        )
        .run(now, job.sessionId);
      return this.requireUploadJob(jobId);
    })();
  }

  requeueAfterCapabilityExpiry(
    jobId: string,
    leaseOwner: string,
    now = Date.now(),
  ): StoredUploadJob {
    return this.database.raw.transaction(() => {
      const job = this.requireUploadJob(jobId);
      const result = this.database.raw
        .prepare(
          `UPDATE upload_jobs SET state = 'queued', next_attempt_at = ?,
            lease_owner = NULL, lease_until = NULL,
            last_error_code = 'signed_upload_expired',
            last_error_message = 'The upload authorization expired and will be renewed.',
            updated_at = ?
          WHERE id = ? AND lease_owner = ? AND state IN ('uploading', 'confirming')`,
        )
        .run(now, now, jobId, leaseOwner);
      if (result.changes !== 1) {
        throw new AppError('upload_lease_lost', 'The upload lease expired.', true);
      }
      this.database.raw
        .prepare(
          `UPDATE sessions SET state = 'pending_upload', updated_at = ?
          WHERE id = ? AND state = 'uploading'`,
        )
        .run(now, job.sessionId);
      return this.requireUploadJob(jobId);
    })();
  }

  recoverUploadLeases(currentOwner: string, now = Date.now()): number {
    return this.database.raw.transaction(() => {
      const stale = this.database.raw
        .prepare(
          `SELECT session_id FROM upload_jobs
          WHERE state IN ('creating_upload', 'uploading', 'confirming')
            AND (lease_owner IS NULL OR lease_owner <> ? OR lease_until IS NULL OR lease_until <= ?)`,
        )
        .all(currentOwner, now) as { session_id: string }[];
      const update = this.database.raw
        .prepare(
          `UPDATE upload_jobs SET state = 'queued', next_attempt_at = NULL,
            lease_owner = NULL, lease_until = NULL, updated_at = ?
          WHERE state IN ('creating_upload', 'uploading', 'confirming')
            AND (lease_owner IS NULL OR lease_owner <> ? OR lease_until IS NULL OR lease_until <= ?)`,
        )
        .run(now, currentOwner, now);
      const sessionUpdate = this.database.raw.prepare(
        `UPDATE sessions SET state = 'pending_upload', updated_at = ?
        WHERE id = ? AND state = 'uploading'`,
      );
      for (const row of stale) sessionUpdate.run(now, row.session_id);
      return update.changes;
    })();
  }

  markInterruptedSessions(now = Date.now()): number {
    const result = this.database.raw
      .prepare(
        `UPDATE sessions SET state = 'interrupted', last_error_code = 'app_restarted',
          last_error_message = 'The booth restarted during this photo session.', updated_at = ?
        WHERE state IN ('countdown', 'capturing')`,
      )
      .run(now);
    return result.changes;
  }

  markSessionAssetUnavailable(sessionId: string, now = Date.now()): StoredSession {
    return this.database.raw.transaction(() => {
      this.database.raw
        .prepare(
          `UPDATE upload_jobs SET state = 'failed', next_attempt_at = NULL,
            lease_owner = NULL, lease_until = NULL,
            last_error_code = 'local_asset_unavailable',
            last_error_message = 'A local photo could not be verified.', updated_at = ?
          WHERE session_id = ? AND state NOT IN ('succeeded', 'cancelled')`,
        )
        .run(now, sessionId);
      const result = this.database.raw
        .prepare(
          `UPDATE sessions SET state = 'interrupted',
            last_error_code = 'local_asset_unavailable',
            last_error_message = 'A local photo could not be verified. Operator recovery is required.',
            updated_at = ? WHERE id = ? AND state <> 'attract'`,
        )
        .run(now, sessionId);
      if (result.changes !== 1) {
        throw new AppError('session_missing', 'The photo session could not be reconciled.');
      }
      return this.requireSession(sessionId);
    })();
  }

  sessionsOlderThan(cutoff: number): StoredSession[] {
    return this.database.raw
      .prepare(
        `${SESSION_SELECT}
        WHERE retention_anchor_at IS NOT NULL AND retention_anchor_at <= ?
          AND cleanup_state IN ('active', 'tombstoning')`,
      )
      .all(cutoff)
      .map((row) => mapSession(row as Record<string, unknown>));
  }

  beginSessionCleanup(sessionId: string, now = Date.now()): StoredSession {
    this.database.raw
      .prepare(
        `UPDATE sessions SET cleanup_state = 'tombstoning', cleanup_started_at = ?, updated_at = ?
        WHERE id = ? AND cleanup_state = 'active'`,
      )
      .run(now, now, sessionId);
    return this.requireSession(sessionId);
  }

  prepareAssetTombstone(assetId: string, tombstonePath: string): StoredAsset {
    const result = this.database.raw
      .prepare(
        `UPDATE session_assets SET cleanup_state = 'tombstoning', tombstone_path = ?
        WHERE id = ? AND cleanup_state = 'active'`,
      )
      .run(tombstonePath, assetId);
    if (result.changes !== 1) {
      const existing = this.getAsset(assetId);
      if (existing?.cleanupState !== 'tombstoning') {
        throw new AppError('cleanup_conflict', 'Local cleanup could not be resumed safely.');
      }
      return existing;
    }
    const asset = this.getAsset(assetId);
    if (!asset) throw new AppError('asset_missing', 'The local asset could not be found.');
    return asset;
  }

  markAssetTombstoned(assetId: string): StoredAsset {
    const result = this.database.raw
      .prepare(
        `UPDATE session_assets SET cleanup_state = 'tombstoned'
        WHERE id = ? AND cleanup_state = 'tombstoning' AND tombstone_path IS NOT NULL`,
      )
      .run(assetId);
    if (result.changes !== 1) {
      const existing = this.getAsset(assetId);
      if (existing?.cleanupState !== 'tombstoned') {
        throw new AppError('cleanup_conflict', 'Local cleanup could not be completed safely.');
      }
      return existing;
    }
    const asset = this.getAsset(assetId);
    if (!asset) throw new AppError('asset_missing', 'The local asset could not be found.');
    return asset;
  }

  listReferencedTombstones(): string[] {
    return (
      this.database.raw
        .prepare(
          `SELECT tombstone_path FROM session_assets
          WHERE tombstone_path IS NOT NULL
            AND cleanup_state IN ('tombstoning', 'tombstoned')`,
        )
        .all() as { tombstone_path: string }[]
    ).map((row) => row.tombstone_path);
  }

  deleteSession(sessionId: string): void {
    this.database.raw.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
  }

  recordAudit(
    operation:
      | 'passcode_bootstrap'
      | 'passcode_change'
      | 'settings_change'
      | 'frame_change'
      | 'upload_retry'
      | 'cleanup',
    outcome: 'success' | 'failure',
    detailCode: string | null,
    now = Date.now(),
  ): void {
    this.database.raw
      .prepare(
        'INSERT INTO audit_log (operation, outcome, detail_code, created_at) VALUES (?, ?, ?, ?)',
      )
      .run(operation, outcome, detailCode, now);
  }

  integrityCheck(): boolean {
    return this.database.raw.pragma('quick_check', { simple: true }) === 'ok';
  }

  private insertFrameRow(frame: Omit<StoredFrame, 'slots'>, slots: FrameLayout): void {
    this.database.raw
      .prepare(
        `INSERT INTO frames
          (id, name, encrypted_path, width, height, byte_size, sha256, revision, sort_order,
            created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        frame.id,
        frame.name,
        frame.encryptedPath,
        frame.width,
        frame.height,
        frame.byteSize,
        frame.sha256,
        frame.revision,
        frame.sortOrder,
        frame.createdAt,
        frame.updatedAt,
      );
    this.insertFrameSlots(frame.id, slots);
  }

  private insertFrameSlots(frameId: string, slots: FrameLayout): void {
    const statement = this.database.raw.prepare(
      `INSERT INTO frame_slots
        (frame_id, slot_index, name, x, y, width, height, crop_mode)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const slot of slots) {
      statement.run(
        frameId,
        slot.slotIndex,
        slot.name,
        slot.x,
        slot.y,
        slot.width,
        slot.height,
        slot.cropMode,
      );
    }
  }

  private insertAsset(asset: NewAsset): void {
    this.database.raw
      .prepare(
        `INSERT INTO session_assets
          (id, session_id, kind, retake_round, shot_number, encrypted_path, content_type,
            width, height, byte_size, sha256, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 'image/jpeg', ?, ?, ?, ?, ?)`,
      )
      .run(
        asset.id,
        asset.sessionId,
        asset.kind,
        asset.retakeRound,
        asset.shotNumber,
        asset.encryptedPath,
        asset.width,
        asset.height,
        asset.byteSize,
        asset.sha256,
        asset.createdAt,
      );
  }
}

function loadFrameRows(database: BoothDatabase, suffix: string, params: unknown[]): StoredFrame[] {
  const rows = database.raw
    .prepare(
      `SELECT id, name, encrypted_path, width, height, byte_size, sha256,
        revision, sort_order, created_at, updated_at FROM frames ${suffix}`,
    )
    .all(...params);
  const slotsStatement = database.raw.prepare(
    `SELECT slot_index, name, x, y, width, height, crop_mode
    FROM frame_slots WHERE frame_id = ? ORDER BY slot_index`,
  );
  const frames: StoredFrame[] = [];
  for (const row of rows) {
    const record = row as Record<string, unknown>;
    const parsedSlots = FrameLayoutSchema.safeParse(
      slotsStatement.all(String(record.id)).map((slot) => {
        const value = slot as Record<string, unknown>;
        return {
          slotIndex: Number(value.slot_index),
          name: String(value.name),
          x: Number(value.x),
          y: Number(value.y),
          width: Number(value.width),
          height: Number(value.height),
          cropMode: String(value.crop_mode),
        };
      }),
    );
    if (!parsedSlots.success) continue;
    frames.push({
      id: String(record.id),
      name: String(record.name),
      encryptedPath: String(record.encrypted_path),
      width: Number(record.width),
      height: Number(record.height),
      byteSize: Number(record.byte_size),
      sha256: String(record.sha256),
      revision: Number(record.revision),
      sortOrder:
        record.sort_order === null || record.sort_order === undefined
          ? null
          : Number(record.sort_order),
      createdAt: Number(record.created_at),
      updatedAt: Number(record.updated_at),
      slots: parsedSlots.data,
    });
  }
  return frames;
}

function mapSettings(row: RawSettingsRow): LocalSettings {
  if (
    row.scrypt_version !== 1 ||
    row.local_retention_days !== 60 ||
    row.cloud_retention_days !== 30
  ) {
    throw new AppError('settings_invalid', 'Retention settings are invalid.');
  }
  return {
    passcodeHash: row.passcode_hash,
    passcodeSalt: row.passcode_salt,
    scryptVersion: 1,
    scryptN: row.scrypt_n,
    scryptR: row.scrypt_r,
    scryptP: row.scrypt_p,
    scryptKeyLength: row.scrypt_key_length,
    activeFrameId: row.active_frame_id,
    collage2FrameId: row.collage_2_frame_id,
    googleFormsUrl: row.google_forms_url,
    localRetentionDays: 60,
    cloudRetentionDays: 30,
    lanEnabled: row.lan_enabled === 1,
    lanBindHost: row.lan_bind_host,
    lanPort: row.lan_port,
    lanTlsSecretRef: row.lan_tls_secret_ref,
    lanCertificateFingerprint: row.lan_certificate_fingerprint,
    cameraAdapter: (row.camera_adapter as CameraAdapterKind | null) ?? 'webcam',
    cameraDeviceId: row.camera_device_id,
    cameraResolution: row.camera_resolution === '720p' ? '720p' : '1080p',
    supabaseUrl: row.supabase_url,
    supabasePublishableKey: row.supabase_publishable_key,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapSession(row: Record<string, unknown>): StoredSession {
  return {
    id: String(row.id),
    state: SessionStateSchema.parse(row.state),
    captureRound: Number(row.capture_round),
    captureCount: Number(row.capture_count),
    selectedOption: Number(row.selected_option ?? 1),
    selectedFrameId: nullableString(row.selected_frame_id),
    collageAssetId: nullableString(row.collage_asset_id),
    cloudPhotoSessionId: nullableString(row.cloud_photo_session_id),
    publicSecretRef: nullableString(row.public_secret_ref),
    readyAt: nullableNumber(row.ready_at),
    expiresAt: nullableNumber(row.expires_at),
    lastErrorCode: nullableString(row.last_error_code),
    lastErrorMessage: nullableString(row.last_error_message),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    completedAt: nullableNumber(row.completed_at),
    retentionAnchorAt: nullableNumber(row.retention_anchor_at),
    cleanupState: row.cleanup_state === 'tombstoning' ? 'tombstoning' : 'active',
    cleanupStartedAt: nullableNumber(row.cleanup_started_at),
  };
}

function mapAsset(row: Record<string, unknown>): StoredAsset {
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    kind: row.kind === 'collage' ? 'collage' : 'capture',
    retakeRound: Number(row.retake_round),
    shotNumber: nullableNumber(row.shot_number),
    encryptedPath: String(row.encrypted_path),
    contentType: 'image/jpeg',
    width: Number(row.width),
    height: Number(row.height),
    byteSize: Number(row.byte_size),
    sha256: String(row.sha256),
    createdAt: Number(row.created_at),
    cleanupState:
      row.cleanup_state === 'tombstoned'
        ? 'tombstoned'
        : row.cleanup_state === 'tombstoning'
          ? 'tombstoning'
          : 'active',
    tombstonePath: nullableString(row.tombstone_path),
  };
}

function mapUploadJob(row: Record<string, unknown>): StoredUploadJob {
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    state: UploadJobStateSchema.parse(row.state),
    attemptCount: Number(row.attempt_count),
    lifetimeFailureCount: Number(row.lifetime_failure_count),
    automaticRetryIndex: Number(row.automatic_retry_index),
    manualRetryCycle: Number(row.manual_retry_cycle),
    nextAttemptAt: nullableNumber(row.next_attempt_at),
    leaseOwner: nullableString(row.lease_owner),
    leaseUntil: nullableNumber(row.lease_until),
    lastErrorCode: nullableString(row.last_error_code),
    lastErrorMessage: nullableString(row.last_error_message),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function nullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') {
    return String(value);
  }
  throw new AppError('database_value_invalid', 'A local database value is invalid.');
}

function nullableNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}
