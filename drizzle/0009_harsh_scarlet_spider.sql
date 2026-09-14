ALTER TABLE `authorization_requests` ADD `management_token_hash` text;--> statement-breakpoint
ALTER TABLE `authorization_requests` ADD `management_token_expires_at` text;--> statement-breakpoint
CREATE UNIQUE INDEX `authorization_requests_management_token_hash_unique` ON `authorization_requests` (`management_token_hash`);