CREATE TABLE `import_outcomes` (
	`id` text PRIMARY KEY NOT NULL,
	`associate_email` text NOT NULL,
	`source_host` text NOT NULL,
	`outcome` text NOT NULL,
	`elapsed_ms` integer DEFAULT 0 NOT NULL,
	`fallback` text DEFAULT '' NOT NULL,
	`bright_data_used` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `import_outcomes_host_created_idx` ON `import_outcomes` (`source_host`,`created_at`);--> statement-breakpoint
CREATE INDEX `import_outcomes_associate_created_idx` ON `import_outcomes` (`associate_email`,`created_at`);