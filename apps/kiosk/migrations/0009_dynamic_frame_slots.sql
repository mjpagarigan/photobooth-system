ALTER TABLE `frame_slots` ADD `z_index` integer NOT NULL DEFAULT 0;
UPDATE `frame_slots` SET `z_index` = `slot_index` - 1;
ALTER TABLE `sessions` ADD `required_shot_count` integer NOT NULL DEFAULT 3;
