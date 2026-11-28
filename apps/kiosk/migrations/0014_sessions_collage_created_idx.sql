CREATE INDEX IF NOT EXISTS sessions_collage_created_idx
  ON sessions(cleanup_state, created_at DESC, id DESC)
  WHERE collage_asset_id IS NOT NULL AND cleanup_state = 'active';
