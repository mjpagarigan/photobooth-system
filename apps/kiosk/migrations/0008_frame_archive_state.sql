ALTER TABLE `frames` ADD `archived` integer NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS `frames_archived_sort_idx` ON `frames` (`archived`, `sort_order`, `created_at`, `id`);
UPDATE `frames` SET `name` = REPLACE(`name`, 'Ministry Fair', 'Celebration') WHERE `name` LIKE '%Ministry Fair%';
