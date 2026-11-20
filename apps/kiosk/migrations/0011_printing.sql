CREATE TABLE IF NOT EXISTS printer_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  adapter TEXT NOT NULL DEFAULT 'windows' CHECK (adapter IN ('windows', 'mock')),
  printer_name TEXT CHECK (printer_name IS NULL OR length(printer_name) BETWEEN 1 AND 260),
  paper_raw_kind INTEGER,
  paper_name TEXT CHECK (paper_name IS NULL OR length(paper_name) <= 260),
  timeout_seconds INTEGER NOT NULL DEFAULT 240 CHECK (timeout_seconds BETWEEN 30 AND 1800),
  icc_profile_path TEXT,
  icc_profile_name TEXT CHECK (icc_profile_name IS NULL OR length(icc_profile_name) <= 260),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  updated_at INTEGER NOT NULL
);

INSERT OR IGNORE INTO printer_settings (id, updated_at) VALUES (1, 0);

-- One row per physical copy. A request groups the copies an operator asked for at once.
CREATE TABLE IF NOT EXISTS print_jobs (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,
  source_asset_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('session', 'reprint', 'calibration', 'color_test')),
  copy_index INTEGER NOT NULL CHECK (copy_index >= 1),
  copy_count INTEGER NOT NULL CHECK (copy_count >= 1 AND copy_index <= copy_count),
  state TEXT NOT NULL CHECK (state IN (
    'waiting_for_photo', 'queued', 'submitting', 'spooled',
    'printed', 'needs_attention', 'failed', 'cancelled'
  )),
  document_key TEXT NOT NULL UNIQUE,
  printer_name TEXT,
  paper_raw_kind INTEGER,
  paper_name TEXT,
  spooler_job_id INTEGER,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  submitted_at INTEGER,
  printed_at INTEGER,
  cancelled_at INTEGER,
  last_error_code TEXT,
  last_error_message TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (request_id, copy_index),
  CHECK ((kind IN ('session', 'reprint')) = (session_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS print_jobs_state_idx ON print_jobs(state, created_at);
CREATE INDEX IF NOT EXISTS print_jobs_session_idx ON print_jobs(session_id);

-- SQLite cannot alter a CHECK constraint, so the audit log is rebuilt with the print operations.
CREATE TABLE audit_log_next (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  operation TEXT NOT NULL CHECK (operation IN (
    'passcode_bootstrap', 'passcode_change', 'settings_change',
    'frame_change', 'upload_retry', 'cleanup',
    'printer_settings_change', 'print_cancel', 'print_resolve', 'reprint', 'print_test'
  )),
  outcome TEXT NOT NULL CHECK (outcome IN ('success', 'failure')),
  detail_code TEXT,
  created_at INTEGER NOT NULL
);
INSERT INTO audit_log_next (id, operation, outcome, detail_code, created_at)
  SELECT id, operation, outcome, detail_code, created_at FROM audit_log;
DROP TABLE audit_log;
ALTER TABLE audit_log_next RENAME TO audit_log;
