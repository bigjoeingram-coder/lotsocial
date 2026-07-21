CREATE TABLE `creative_projects` (
	`id` text PRIMARY KEY NOT NULL,
	`vehicle_id` text NOT NULL,
	`associate_email` text NOT NULL,
	`selected_images` text DEFAULT '[]' NOT NULL,
	`style` text NOT NULL,
	`duration_seconds` integer DEFAULT 30 NOT NULL,
	`voiceover_script` text NOT NULL,
	`social_caption` text NOT NULL,
	`end_card_name` text NOT NULL,
	`end_card_phone` text DEFAULT '' NOT NULL,
	`end_card_email` text DEFAULT '' NOT NULL,
	`end_card_cta` text DEFAULT 'Message me for details' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `creative_projects_associate_idx` ON `creative_projects` (`associate_email`,`created_at`);--> statement-breakpoint
CREATE INDEX `creative_projects_vehicle_idx` ON `creative_projects` (`vehicle_id`,`created_at`);