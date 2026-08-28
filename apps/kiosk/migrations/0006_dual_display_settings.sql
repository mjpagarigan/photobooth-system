ALTER TABLE settings ADD COLUMN dual_display_mode TEXT NOT NULL DEFAULT 'auto'
  CHECK (dual_display_mode IN ('auto', 'enabled', 'disabled'));
ALTER TABLE settings ADD COLUMN swap_displays INTEGER NOT NULL DEFAULT 0
  CHECK (swap_displays IN (0, 1));
ALTER TABLE settings ADD COLUMN qr_dismiss_seconds INTEGER NOT NULL DEFAULT 45
  CHECK (qr_dismiss_seconds >= 10 AND qr_dismiss_seconds <= 300);
