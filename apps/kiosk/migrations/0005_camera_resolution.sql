ALTER TABLE settings ADD COLUMN camera_resolution TEXT NOT NULL DEFAULT '1080p'
  CHECK (camera_resolution IN ('720p', '1080p'));
