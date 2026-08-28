ALTER TABLE `settings` ADD `google_photos_enabled` integer NOT NULL DEFAULT 0;
ALTER TABLE `settings` ADD `google_photos_email` text;
ALTER TABLE `settings` ADD `google_photos_album_id` text;
ALTER TABLE `settings` ADD `google_photos_album_title` text;
ALTER TABLE `settings` ADD `google_photos_album_share_url` text;
