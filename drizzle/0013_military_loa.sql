CREATE TABLE `delivery_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`slot_id` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`adapter` text NOT NULL,
	`request_snapshot` text DEFAULT '{}' NOT NULL,
	`outcome` text DEFAULT 'in_flight' NOT NULL,
	`platform_post_id` text DEFAULT '' NOT NULL,
	`platform_url` text DEFAULT '' NOT NULL,
	`provider_request_id` text DEFAULT '' NOT NULL,
	`error_code` text DEFAULT '' NOT NULL,
	`error_message` text DEFAULT '' NOT NULL,
	`retryable` integer DEFAULT 0 NOT NULL,
	`raw_response_key` text DEFAULT '' NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`last_checked_at` text
);
--> statement-breakpoint
CREATE INDEX `delivery_attempts_slot_idx` ON `delivery_attempts` (`slot_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `post_slots` (
	`id` text PRIMARY KEY NOT NULL,
	`variant_id` text NOT NULL,
	`destination_id` text NOT NULL,
	`scheduled_at_utc` text NOT NULL,
	`timezone` text DEFAULT 'UTC' NOT NULL,
	`slot_status` text DEFAULT 'DRAFT' NOT NULL,
	`idempotency_key` text NOT NULL,
	`approved_revision_hash` text DEFAULT '' NOT NULL,
	`worker_id` text DEFAULT '' NOT NULL,
	`attempt_id` text DEFAULT '' NOT NULL,
	`claimed_at` text,
	`lease_expires_at` text,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`next_retry_at` text,
	`uncertain_since` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `post_slots_idempotency_key_unique` ON `post_slots` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `post_slots_due_idx` ON `post_slots` (`slot_status`,`scheduled_at_utc`);--> statement-breakpoint
CREATE INDEX `post_slots_lease_idx` ON `post_slots` (`slot_status`,`lease_expires_at`);--> statement-breakpoint
CREATE INDEX `post_slots_variant_idx` ON `post_slots` (`variant_id`);--> statement-breakpoint
CREATE TABLE `post_variants` (
	`id` text PRIMARY KEY NOT NULL,
	`creative_project_id` text NOT NULL,
	`destination_id` text NOT NULL,
	`platform` text NOT NULL,
	`caption` text DEFAULT '' NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`platform_options` text DEFAULT '{}' NOT NULL,
	`render_job_id` text DEFAULT '' NOT NULL,
	`media_storage_key` text DEFAULT '' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`revision_hash` text NOT NULL,
	`approval_status` text DEFAULT 'DRAFT' NOT NULL,
	`approved_revision_hash` text DEFAULT '' NOT NULL,
	`approved_by` text DEFAULT '' NOT NULL,
	`approved_at` text,
	`validation_status` text DEFAULT 'unchecked' NOT NULL,
	`validation_errors` text DEFAULT '[]' NOT NULL,
	`supersedes_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `post_variants_project_idx` ON `post_variants` (`creative_project_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `posting_audit_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slot_id` text DEFAULT '' NOT NULL,
	`variant_id` text DEFAULT '' NOT NULL,
	`actor_type` text NOT NULL,
	`actor_email` text DEFAULT '' NOT NULL,
	`action` text NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `posting_audit_slot_idx` ON `posting_audit_events` (`slot_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `posting_audit_variant_idx` ON `posting_audit_events` (`variant_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `social_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_email` text NOT NULL,
	`platform` text NOT NULL,
	`account_label` text DEFAULT '' NOT NULL,
	`credentials_ref` text DEFAULT '' NOT NULL,
	`granted_scopes` text DEFAULT '[]' NOT NULL,
	`health_state` text DEFAULT 'UNVERIFIED' NOT NULL,
	`health_checked_at` text,
	`last_success_at` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `social_connections_owner_idx` ON `social_connections` (`owner_email`,`platform`);--> statement-breakpoint
CREATE TABLE `social_destinations` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_id` text NOT NULL,
	`platform` text NOT NULL,
	`platform_ref` text NOT NULL,
	`kind` text DEFAULT 'member' NOT NULL,
	`display_name` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `social_destinations_connection_ref_unique` ON `social_destinations` (`connection_id`,`platform_ref`);