ALTER TABLE `post_slots` ADD `send_started_at` text;--> statement-breakpoint
ALTER TABLE `post_slots` ADD `last_reconciled_at` text;--> statement-breakpoint
CREATE UNIQUE INDEX `post_slots_live_variant_destination_unique` ON `post_slots` (`variant_id`,`destination_id`) WHERE slot_status NOT IN ('CANCELED','SUPERSEDED','FAILED');--> statement-breakpoint
ALTER TABLE `post_variants` ADD `media_checksum` text DEFAULT '' NOT NULL;