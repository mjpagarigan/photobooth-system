ALTER TABLE settings ADD COLUMN capture_countdown_seconds INTEGER NOT NULL DEFAULT 8
  CHECK (capture_countdown_seconds BETWEEN 1 AND 30);
ALTER TABLE settings ADD COLUMN capture_review_mode TEXT NOT NULL DEFAULT 'per_shot'
  CHECK (capture_review_mode IN ('per_shot', 'continuous'));

CREATE TABLE frame_slots_next (
  frame_id TEXT NOT NULL REFERENCES frames(id) ON DELETE CASCADE,
  slot_index INTEGER NOT NULL CHECK (slot_index BETWEEN 1 AND 10),
  z_index INTEGER NOT NULL DEFAULT 0 CHECK (z_index BETWEEN 0 AND 9),
  name TEXT NOT NULL,
  x REAL NOT NULL CHECK (x >= 0 AND x <= 1),
  y REAL NOT NULL CHECK (y >= 0 AND y <= 1),
  width REAL NOT NULL CHECK (width > 0 AND width <= 1 AND x + width <= 1.000000001),
  height REAL NOT NULL CHECK (height > 0 AND height <= 1 AND y + height <= 1.000000001),
  crop_mode TEXT NOT NULL CHECK (crop_mode IN ('crop-to-fill', 'fit')),
  PRIMARY KEY (frame_id, slot_index)
);
INSERT INTO frame_slots_next (frame_id, slot_index, z_index, name, x, y, width, height, crop_mode)
  SELECT frame_id, slot_index, z_index, name, x, y, width, height, crop_mode FROM frame_slots;
DROP TABLE frame_slots;
ALTER TABLE frame_slots_next RENAME TO frame_slots;

CREATE TABLE sessions_next (
  id TEXT PRIMARY KEY,
  state TEXT NOT NULL CHECK (state IN (
    'attract', 'countdown', 'capturing', 'shot_review', 'review', 'processing',
    'pending_upload', 'uploading', 'ready', 'final',
    'camera_error', 'upload_failed', 'interrupted'
  )),
  capture_round INTEGER NOT NULL DEFAULT 0 CHECK (capture_round >= 0),
  capture_count INTEGER NOT NULL DEFAULT 0 CHECK (capture_count BETWEEN 0 AND 10),
  required_shot_count INTEGER NOT NULL DEFAULT 3 CHECK (required_shot_count BETWEEN 1 AND 10),
  selected_option INTEGER NOT NULL DEFAULT 1,
  selected_frame_id TEXT,
  capture_countdown_seconds INTEGER NOT NULL DEFAULT 8
    CHECK (capture_countdown_seconds BETWEEN 1 AND 30),
  capture_review_mode TEXT NOT NULL DEFAULT 'per_shot'
    CHECK (capture_review_mode IN ('per_shot', 'continuous')),
  collage_asset_id TEXT,
  cloud_photo_session_id TEXT,
  public_secret_ref TEXT,
  ready_at INTEGER,
  expires_at INTEGER,
  last_error_code TEXT,
  last_error_message TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER,
  retention_anchor_at INTEGER,
  cleanup_state TEXT NOT NULL DEFAULT 'active' CHECK (cleanup_state IN ('active', 'tombstoning')),
  cleanup_started_at INTEGER,
  CHECK (state <> 'shot_review' OR capture_count < required_shot_count)
);
INSERT INTO sessions_next (
  id, state, capture_round, capture_count, required_shot_count, selected_option,
  selected_frame_id, capture_countdown_seconds, capture_review_mode,
  collage_asset_id, cloud_photo_session_id, public_secret_ref, ready_at, expires_at,
  last_error_code, last_error_message, created_at, updated_at, completed_at,
  retention_anchor_at, cleanup_state, cleanup_started_at
)
  SELECT
    id, state, capture_round, capture_count, required_shot_count, selected_option,
    selected_frame_id, 8, 'continuous',
    collage_asset_id, cloud_photo_session_id, public_secret_ref, ready_at, expires_at,
    last_error_code, last_error_message, created_at, updated_at, completed_at,
    retention_anchor_at, cleanup_state, cleanup_started_at
  FROM sessions;
DROP TABLE sessions;
ALTER TABLE sessions_next RENAME TO sessions;
CREATE INDEX IF NOT EXISTS sessions_state_updated_idx ON sessions(state, updated_at);
CREATE INDEX IF NOT EXISTS sessions_retention_idx ON sessions(cleanup_state, retention_anchor_at);

CREATE TABLE session_assets_next (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('capture', 'collage')),
  retake_round INTEGER NOT NULL DEFAULT 0 CHECK (retake_round >= 0),
  shot_number INTEGER CHECK (shot_number BETWEEN 1 AND 10),
  shot_attempt INTEGER NOT NULL DEFAULT 1 CHECK (shot_attempt >= 1),
  encrypted_path TEXT NOT NULL UNIQUE,
  content_type TEXT NOT NULL CHECK (content_type = 'image/jpeg'),
  width INTEGER NOT NULL CHECK (width > 0 AND width <= 12000),
  height INTEGER NOT NULL CHECK (height > 0 AND height <= 12000),
  byte_size INTEGER NOT NULL CHECK (byte_size > 0),
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
  created_at INTEGER NOT NULL,
  cleanup_state TEXT NOT NULL DEFAULT 'active' CHECK (cleanup_state IN ('active', 'tombstoning', 'tombstoned')),
  tombstone_path TEXT,
  UNIQUE (session_id, kind, retake_round, shot_number, shot_attempt)
);
INSERT INTO session_assets_next (
  id, session_id, kind, retake_round, shot_number, shot_attempt,
  encrypted_path, content_type, width, height, byte_size, sha256,
  created_at, cleanup_state, tombstone_path
)
  SELECT
    id, session_id, kind, retake_round, shot_number, 1,
    encrypted_path, content_type, width, height, byte_size, sha256,
    created_at, cleanup_state, tombstone_path
  FROM session_assets;
DROP TABLE session_assets;
ALTER TABLE session_assets_next RENAME TO session_assets;
CREATE INDEX IF NOT EXISTS session_assets_session_idx
  ON session_assets(session_id, kind, retake_round, shot_number, shot_attempt);
