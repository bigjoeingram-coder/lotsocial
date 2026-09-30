CREATE TABLE `account_email_verifications` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`source_type` text NOT NULL,
	`source_token_hash` text NOT NULL,
	`email` text NOT NULL,
	`display_name` text NOT NULL,
	`phone` text NOT NULL,
	`dealership_name` text NOT NULL,
	`dealership_domain` text NOT NULL,
	`rooftop_location` text NOT NULL,
	`expires_at` text NOT NULL,
	`used_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `account_email_verifications_token_hash_unique` ON `account_email_verifications` (`token_hash`);--> statement-breakpoint
CREATE INDEX `account_email_verifications_email_idx` ON `account_email_verifications` (`email`,`created_at`);--> statement-breakpoint
CREATE INDEX `account_email_verifications_expiry_idx` ON `account_email_verifications` (`expires_at`);