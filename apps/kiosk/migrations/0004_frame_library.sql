ALTER TABLE frames ADD COLUMN sort_order INTEGER;
UPDATE frames SET sort_order = 1 WHERE id IN (SELECT active_frame_id FROM settings WHERE id = 1);
UPDATE frames SET sort_order = 2 WHERE id IN (SELECT collage_2_frame_id FROM settings WHERE id = 1)
  AND sort_order IS NULL;
