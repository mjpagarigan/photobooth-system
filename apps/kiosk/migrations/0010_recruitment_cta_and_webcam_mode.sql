ALTER TABLE settings ADD COLUMN recruitment_button_text TEXT NOT NULL DEFAULT 'Join a ministry'
  CHECK (
    recruitment_button_text = trim(recruitment_button_text)
    AND length(recruitment_button_text) BETWEEN 1 AND 80
    AND instr(recruitment_button_text, char(10)) = 0
    AND instr(recruitment_button_text, char(13)) = 0
  );

ALTER TABLE settings ADD COLUMN webcam_always_active INTEGER NOT NULL DEFAULT 0
  CHECK (webcam_always_active IN (0, 1));
