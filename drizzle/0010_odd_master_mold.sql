CREATE TABLE `account_login_links` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` text NOT NULL,
	`used_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `account_login_links_token_hash_unique` ON `account_login_links` (`token_hash`);--> statement-breakpoint
CREATE INDEX `account_login_links_account_idx` ON `account_login_links` (`account_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `associate_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`display_name` text NOT NULL,
	`phone` text DEFAULT '' NOT NULL,
	`dealership_name` text NOT NULL,
	`dealership_domain` text NOT NULL,
	`rooftop_location` text DEFAULT '' NOT NULL,
	`profile_photo_url` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `associate_accounts_email_unique` ON `associate_accounts` (`email`);--> statement-breakpoint
CREATE TABLE `associate_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` text NOT NULL,
	`revoked_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `associate_sessions_token_hash_unique` ON `associate_sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `associate_sessions_account_idx` ON `associate_sessions` (`account_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `associate_sessions_expiry_idx` ON `associate_sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `pilot_invites` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`email` text NOT NULL,
	`dealership_name` text NOT NULL,
	`dealership_domain` text NOT NULL,
	`expires_at` text NOT NULL,
	`used_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pilot_invites_token_hash_unique` ON `pilot_invites` (`token_hash`);--> statement-breakpoint
CREATE INDEX `pilot_invites_email_idx` ON `pilot_invites` (`email`,`created_at`);