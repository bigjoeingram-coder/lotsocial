CREATE TABLE `rate_limit_counters` (
	`counter_key` text NOT NULL,
	`counter_scope` text NOT NULL,
	`counter_subject` text NOT NULL,
	`counter_day` text NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`counter_key`, `counter_day`)
);
--> statement-breakpoint
CREATE INDEX `rate_limit_counters_scope_day_idx` ON `rate_limit_counters` (`counter_scope`,`counter_day`);