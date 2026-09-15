PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_authorization_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`approval_token_hash` text NOT NULL,
	`dealership_name` text NOT NULL,
	`rooftop_location` text NOT NULL,
	`dealership_domain` text DEFAULT '' NOT NULL,
	`associate_name` text NOT NULL,
	`associate_email` text NOT NULL,
	`manager_name` text NOT NULL,
	`manager_title` text NOT NULL,
	`manager_email` text NOT NULL,
	`manager_phone` text DEFAULT '' NOT NULL,
	`provider_name` text DEFAULT 'Unknown' NOT NULL,
	`provider_contact_name` text DEFAULT '' NOT NULL,
	`provider_contact_email` text DEFAULT '' NOT NULL,
	`requested_permissions` text NOT NULL,
	`approved_permissions` text,
	`status` text DEFAULT 'requested' NOT NULL,
	`email_delivery_status` text DEFAULT 'pending' NOT NULL,
	`email_message_id` text,
	`typed_signature` text,
	`manager_notes` text DEFAULT '' NOT NULL,
	`terms_version` text DEFAULT '2026-09-14-v2' NOT NULL,
	`requested_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`decided_at` text,
	`expires_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_authorization_requests`("id", "approval_token_hash", "dealership_name", "rooftop_location", "dealership_domain", "associate_name", "associate_email", "manager_name", "manager_title", "manager_email", "manager_phone", "provider_name", "provider_contact_name", "provider_contact_email", "requested_permissions", "approved_permissions", "status", "email_delivery_status", "email_message_id", "typed_signature", "manager_notes", "terms_version", "requested_at", "decided_at", "expires_at", "created_at", "updated_at") SELECT "id", "approval_token_hash", "dealership_name", "rooftop_location", "dealership_domain", "associate_name", "associate_email", "manager_name", "manager_title", "manager_email", "manager_phone", "provider_name", "provider_contact_name", "provider_contact_email", "requested_permissions", "approved_permissions", "status", "email_delivery_status", "email_message_id", "typed_signature", "manager_notes", "terms_version", "requested_at", "decided_at", "expires_at", "created_at", "updated_at" FROM `authorization_requests`;--> statement-breakpoint
DROP TABLE `authorization_requests`;--> statement-breakpoint
ALTER TABLE `__new_authorization_requests` RENAME TO `authorization_requests`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `authorization_requests_approval_token_hash_unique` ON `authorization_requests` (`approval_token_hash`);--> statement-breakpoint
CREATE INDEX `authorization_requests_status_idx` ON `authorization_requests` (`status`,`requested_at`);