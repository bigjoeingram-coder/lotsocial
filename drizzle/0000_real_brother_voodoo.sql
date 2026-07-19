CREATE TABLE `authorization_audit_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`request_id` text NOT NULL,
	`actor_type` text NOT NULL,
	`actor_email` text DEFAULT '' NOT NULL,
	`action` text NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `authorization_requests` (
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
	`terms_version` text DEFAULT '2026-07-18-v1' NOT NULL,
	`requested_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`decided_at` text,
	`expires_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `authorization_requests_approval_token_hash_unique` ON `authorization_requests` (`approval_token_hash`);