ALTER TABLE settings ADD COLUMN camera_zoom_percent INTEGER NOT NULL DEFAULT 100
  CHECK (camera_zoom_percent BETWEEN 100 AND 160);
