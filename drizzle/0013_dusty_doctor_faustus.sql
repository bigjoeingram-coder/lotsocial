CREATE TABLE `usage_events` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text DEFAULT '' NOT NULL,
	`associate_email` text NOT NULL,
	`event_type` text NOT NULL,
	`entity_type` text DEFAULT '' NOT NULL,
	`entity_id` text DEFAULT '' NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `usage_events_associate_created_idx` ON `usage_events` (`associate_email`,`created_at`);--> statement-breakpoint
CREATE INDEX `usage_events_created_event_idx` ON `usage_events` (`created_at`,`event_type`);