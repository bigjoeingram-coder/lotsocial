CREATE TABLE `authorization_management_links` (
	`request_id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `authorization_management_links_token_hash_unique` ON `authorization_management_links` (`token_hash`);--> statement-breakpoint
CREATE INDEX `authorization_management_links_expiry_idx` ON `authorization_management_links` (`expires_at`);