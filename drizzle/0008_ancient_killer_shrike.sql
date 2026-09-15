CREATE TABLE `import_outcomes` (
	`id` text PRIMARY KEY NOT NULL,
	`associate_email` text NOT NULL,
	`source_host` text NOT NULL,
	`outcome` text NOT NULL,
	`elapsed_ms` integer NOT NULL,
	`fallback` text DEFAULT 'none' NOT NULL,
	`bright_data_used` integer DEFAULT 0 NOT NULL,
	`notice` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `import_outcomes_created_idx` ON `import_outcomes` (`created_at`);--> statement-breakpoint
CREATE INDEX `import_outcomes_host_created_idx` ON `import_outcomes` (`source_host`,`created_at`);