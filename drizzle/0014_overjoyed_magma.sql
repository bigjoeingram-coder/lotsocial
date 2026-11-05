CREATE TABLE `shared_join_tokens` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`expires_at` text NOT NULL,
	`max_signups` integer NOT NULL,
	`signup_count` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `shared_join_tokens_expiry_idx` ON `shared_join_tokens` (`expires_at`);