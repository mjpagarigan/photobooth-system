import { blob, integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const settings = sqliteTable('settings', {
  id: integer('id').primaryKey(),
  passcodeHash: blob('passcode_hash', { mode: 'buffer' }),
  passcodeSalt: blob('passcode_salt', { mode: 'buffer' }),
  scryptVersion: integer('scrypt_version').notNull(),
  scryptN: integer('scrypt_n').notNull(),
  scryptR: integer('scrypt_r').notNull(),
  scryptP: integer('scrypt_p').notNull(),
  scryptKeyLength: integer('scrypt_key_length').notNull(),
  activeFrameId: text('active_frame_id'),
  collage2FrameId: text('collage_2_frame_id'),
  googleFormsUrl: text('google_forms_url'),
  recruitmentButtonText: text('recruitment_button_text').notNull().default('Join a ministry'),
  localRetentionDays: integer('local_retention_days').notNull(),
  cloudRetentionDays: integer('cloud_retention_days').notNull(),
  lanEnabled: integer('lan_enabled', { mode: 'boolean' }).notNull(),
  lanBindHost: text('lan_bind_host').notNull(),
  lanPort: integer('lan_port').notNull(),
  lanTlsSecretRef: text('lan_tls_secret_ref'),
  lanCertificateFingerprint: text('lan_certificate_fingerprint'),
  cameraAdapter: text('camera_adapter', {
    enum: ['mock', 'sony', 'webcam', 'internal_webcam', 'nikon'],
  }),
  cameraDeviceId: text('camera_device_id'),
  cameraResolution: text('camera_resolution', { enum: ['720p', '1080p'] }).notNull(),
  cameraZoomPercent: integer('camera_zoom_percent').notNull().default(100),
  webcamAlwaysActive: integer('webcam_always_active', { mode: 'boolean' }).notNull().default(false),
  supabaseUrl: text('supabase_url'),
  supabasePublishableKey: text('supabase_publishable_key'),
  dualDisplayMode: text('dual_display_mode', { enum: ['auto', 'enabled', 'disabled'] })
    .notNull()
    .default('auto'),
  swapDisplays: integer('swap_displays', { mode: 'boolean' }).notNull().default(false),
  qrDismissSeconds: integer('qr_dismiss_seconds').notNull().default(45),
  googlePhotosEnabled: integer('google_photos_enabled', { mode: 'boolean' })
    .notNull()
    .default(false),
  googlePhotosEmail: text('google_photos_email'),
  googlePhotosAlbumId: text('google_photos_album_id'),
  googlePhotosAlbumTitle: text('google_photos_album_title'),
  googlePhotosAlbumShareUrl: text('google_photos_album_share_url'),
  captureCountdownSeconds: integer('capture_countdown_seconds').notNull().default(8),
  captureReviewMode: text('capture_review_mode', { enum: ['per_shot', 'continuous'] })
    .notNull()
    .default('per_shot'),
  revision: integer('revision').notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const frames = sqliteTable('frames', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  encryptedPath: text('encrypted_path').notNull().unique(),
  width: integer('width').notNull(),
  height: integer('height').notNull(),
  byteSize: integer('byte_size').notNull(),
  sha256: text('sha256').notNull(),
  revision: integer('revision').notNull(),
  sortOrder: integer('sort_order'),
  archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const frameSlots = sqliteTable(
  'frame_slots',
  {
    frameId: text('frame_id')
      .notNull()
      .references(() => frames.id, { onDelete: 'cascade' }),
    slotIndex: integer('slot_index').notNull(),
    zIndex: integer('z_index').notNull().default(0),
    name: text('name').notNull(),
    x: real('x').notNull(),
    y: real('y').notNull(),
    width: real('width').notNull(),
    height: real('height').notNull(),
    cropMode: text('crop_mode', { enum: ['crop-to-fill', 'fit'] }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.frameId, table.slotIndex] })],
);

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  state: text('state', {
    enum: [
      'attract',
      'countdown',
      'capturing',
      'shot_review',
      'review',
      'processing',
      'pending_upload',
      'uploading',
      'ready',
      'final',
      'camera_error',
      'upload_failed',
      'interrupted',
    ],
  }).notNull(),
  captureRound: integer('capture_round').notNull(),
  captureCount: integer('capture_count').notNull(),
  requiredShotCount: integer('required_shot_count').notNull().default(3),
  selectedOption: integer('selected_option').notNull().default(1),
  selectedFrameId: text('selected_frame_id'),
  captureCountdownSeconds: integer('capture_countdown_seconds').notNull().default(8),
  captureReviewMode: text('capture_review_mode', { enum: ['per_shot', 'continuous'] })
    .notNull()
    .default('per_shot'),
  collageAssetId: text('collage_asset_id'),
  cloudPhotoSessionId: text('cloud_photo_session_id'),
  publicSecretRef: text('public_secret_ref'),
  readyAt: integer('ready_at'),
  expiresAt: integer('expires_at'),
  lastErrorCode: text('last_error_code'),
  lastErrorMessage: text('last_error_message'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  completedAt: integer('completed_at'),
  retentionAnchorAt: integer('retention_anchor_at'),
  cleanupState: text('cleanup_state', { enum: ['active', 'tombstoning'] }).notNull(),
  cleanupStartedAt: integer('cleanup_started_at'),
});

export const sessionAssets = sqliteTable('session_assets', {
  id: text('id').primaryKey(),
  sessionId: text('session_id')
    .notNull()
    .references(() => sessions.id, { onDelete: 'cascade' }),
  kind: text('kind', { enum: ['capture', 'collage'] }).notNull(),
  retakeRound: integer('retake_round').notNull(),
  shotNumber: integer('shot_number'),
  shotAttempt: integer('shot_attempt').notNull().default(1),
  encryptedPath: text('encrypted_path').notNull().unique(),
  contentType: text('content_type', { enum: ['image/jpeg'] }).notNull(),
  width: integer('width').notNull(),
  height: integer('height').notNull(),
  byteSize: integer('byte_size').notNull(),
  sha256: text('sha256').notNull(),
  createdAt: integer('created_at').notNull(),
  cleanupState: text('cleanup_state', {
    enum: ['active', 'tombstoning', 'tombstoned'],
  }).notNull(),
  tombstonePath: text('tombstone_path'),
});

export const uploadJobs = sqliteTable('upload_jobs', {
  id: text('id').primaryKey(),
  sessionId: text('session_id')
    .notNull()
    .unique()
    .references(() => sessions.id, { onDelete: 'cascade' }),
  state: text('state', {
    enum: [
      'queued',
      'creating_upload',
      'uploading',
      'confirming',
      'retry_wait',
      'failed',
      'succeeded',
      'cancelled',
    ],
  }).notNull(),
  attemptCount: integer('attempt_count').notNull(),
  lifetimeFailureCount: integer('lifetime_failure_count').notNull(),
  automaticRetryIndex: integer('automatic_retry_index').notNull(),
  manualRetryCycle: integer('manual_retry_cycle').notNull(),
  nextAttemptAt: integer('next_attempt_at'),
  leaseOwner: text('lease_owner'),
  leaseUntil: integer('lease_until'),
  lastErrorCode: text('last_error_code'),
  lastErrorMessage: text('last_error_message'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const auditLog = sqliteTable('audit_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  operation: text('operation', {
    enum: [
      'passcode_bootstrap',
      'passcode_change',
      'settings_change',
      'frame_change',
      'upload_retry',
      'cleanup',
      'printer_settings_change',
      'print_cancel',
      'print_resolve',
      'reprint',
      'print_test',
    ],
  }).notNull(),
  outcome: text('outcome', { enum: ['success', 'failure'] }).notNull(),
  detailCode: text('detail_code'),
  createdAt: integer('created_at').notNull(),
});

export const printerSettings = sqliteTable('printer_settings', {
  id: integer('id').primaryKey(),
  adapter: text('adapter', { enum: ['windows', 'mock'] }).notNull(),
  printerName: text('printer_name'),
  paperRawKind: integer('paper_raw_kind'),
  paperName: text('paper_name'),
  timeoutSeconds: integer('timeout_seconds').notNull(),
  iccProfilePath: text('icc_profile_path'),
  iccProfileName: text('icc_profile_name'),
  revision: integer('revision').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const printJobs = sqliteTable('print_jobs', {
  id: text('id').primaryKey(),
  requestId: text('request_id').notNull(),
  sessionId: text('session_id').references(() => sessions.id, { onDelete: 'cascade' }),
  sourceAssetId: text('source_asset_id'),
  kind: text('kind', { enum: ['session', 'reprint', 'calibration', 'color_test'] }).notNull(),
  copyIndex: integer('copy_index').notNull(),
  copyCount: integer('copy_count').notNull(),
  state: text('state', {
    enum: [
      'waiting_for_photo',
      'queued',
      'submitting',
      'spooled',
      'printed',
      'needs_attention',
      'failed',
      'cancelled',
    ],
  }).notNull(),
  documentKey: text('document_key').notNull().unique(),
  printerName: text('printer_name'),
  paperRawKind: integer('paper_raw_kind'),
  paperName: text('paper_name'),
  spoolerJobId: integer('spooler_job_id'),
  attemptCount: integer('attempt_count').notNull(),
  submittedAt: integer('submitted_at'),
  printedAt: integer('printed_at'),
  cancelledAt: integer('cancelled_at'),
  lastErrorCode: text('last_error_code'),
  lastErrorMessage: text('last_error_message'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const databaseSchema = {
  settings,
  frames,
  frameSlots,
  sessions,
  sessionAssets,
  uploadJobs,
  auditLog,
  printerSettings,
  printJobs,
};

export type SettingsRow = typeof settings.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;
export type SessionAssetRow = typeof sessionAssets.$inferSelect;
export type UploadJobRow = typeof uploadJobs.$inferSelect;
export type FrameRow = typeof frames.$inferSelect;
