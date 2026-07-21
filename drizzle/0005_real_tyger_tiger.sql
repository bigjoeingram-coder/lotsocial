CREATE TABLE `creative_render_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`associate_email` text NOT NULL,
	`provider` text DEFAULT 'shotstack' NOT NULL,
	`provider_render_id` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'prepared' NOT NULL,
	`render_plan` text NOT NULL,
	`output_url` text DEFAULT '' NOT NULL,
	`error_message` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `creative_render_jobs_project_idx` ON `creative_render_jobs` (`project_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `creative_render_jobs_associate_idx` ON `creative_render_jobs` (`associate_email`,`created_at`);