CREATE TABLE `provider_verifications` (
	`request_id` text PRIMARY KEY NOT NULL,
	`verification_token_hash` text NOT NULL,
	`provider_name` text NOT NULL,
	`contact_name` text NOT NULL,
	`contact_email` text NOT NULL,
	`delivery_method` text DEFAULT '' NOT NULL,
	`feed_format` text DEFAULT '' NOT NULL,
	`connection_notes` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`typed_signature` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`decided_at` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `provider_verifications_verification_token_hash_unique` ON `provider_verifications` (`verification_token_hash`);