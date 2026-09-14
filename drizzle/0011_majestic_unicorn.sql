CREATE TABLE `import_evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`vehicle_id` text NOT NULL,
	`associate_email` text NOT NULL,
	`dealership_tenant` text NOT NULL,
	`source_url` text NOT NULL,
	`source_host` text NOT NULL,
	`captured_at` text NOT NULL,
	`content_sha256` text NOT NULL,
	`html_storage_key` text NOT NULL,
	`screenshot_storage_key` text DEFAULT '' NOT NULL,
	`screenshot_status` text DEFAULT 'unavailable' NOT NULL,
	`price_at_capture` text DEFAULT '' NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`vin_at_capture` text DEFAULT '' NOT NULL,
	`stock_at_capture` text DEFAULT '' NOT NULL,
	`title_at_capture` text NOT NULL,
	`purpose_project_id` text,
	`purpose_note` text NOT NULL,
	`source_type` text DEFAULT 'vdp_one_time' NOT NULL,
	`content_type` text DEFAULT 'text/html; charset=utf-8' NOT NULL,
	`storage_bytes` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `import_evidence_vehicle_idx` ON `import_evidence` (`vehicle_id`,`captured_at`);--> statement-breakpoint
CREATE INDEX `import_evidence_tenant_idx` ON `import_evidence` (`dealership_tenant`,`captured_at`);--> statement-breakpoint
CREATE INDEX `import_evidence_associate_idx` ON `import_evidence` (`associate_email`,`captured_at`);--> statement-breakpoint
ALTER TABLE `associate_accounts` ADD `role` text DEFAULT 'associate' NOT NULL;--> statement-breakpoint
ALTER TABLE `creative_projects` ADD `disclaimer_version` text DEFAULT '2026-09-14-v1' NOT NULL;