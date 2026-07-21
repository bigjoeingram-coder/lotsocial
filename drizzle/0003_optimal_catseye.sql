CREATE TABLE `imported_vehicles` (
	`id` text PRIMARY KEY NOT NULL,
	`associate_email` text NOT NULL,
	`source_url` text NOT NULL,
	`source_host` text NOT NULL,
	`title` text NOT NULL,
	`vin` text DEFAULT '' NOT NULL,
	`stock_number` text DEFAULT '' NOT NULL,
	`year` text DEFAULT '' NOT NULL,
	`make` text DEFAULT '' NOT NULL,
	`model` text DEFAULT '' NOT NULL,
	`trim` text DEFAULT '' NOT NULL,
	`price` text DEFAULT '' NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`image_urls` text DEFAULT '[]' NOT NULL,
	`facts` text DEFAULT '{}' NOT NULL,
	`source_type` text DEFAULT 'vdp_one_time' NOT NULL,
	`authorization_certified_at` text NOT NULL,
	`imported_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `imported_vehicles_associate_idx` ON `imported_vehicles` (`associate_email`,`imported_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `imported_vehicles_associate_source_unique` ON `imported_vehicles` (`associate_email`,`source_url`);