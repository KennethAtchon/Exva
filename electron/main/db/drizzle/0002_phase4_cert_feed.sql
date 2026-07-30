-- Phase 4: adapter certification persistence + equity feed label on coverage.

CREATE TABLE `broker_adapter_cert_states` (
	`broker_account_id` text PRIMARY KEY NOT NULL,
	`cert_run_id` text NOT NULL,
	`broker_type` text NOT NULL,
	`mode` text NOT NULL,
	`passed` integer NOT NULL,
	`checks_json` text NOT NULL,
	`certified_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`broker_account_id`) REFERENCES `broker_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
CREATE TABLE `broker_adapter_cert_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`broker_account_id` text NOT NULL,
	`broker_type` text NOT NULL,
	`mode` text NOT NULL,
	`passed` integer NOT NULL,
	`checks_json` text NOT NULL,
	`certified_at` text NOT NULL,
	FOREIGN KEY (`broker_account_id`) REFERENCES `broker_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
CREATE INDEX `idx_adapter_cert_runs_account` ON `broker_adapter_cert_runs` (`broker_account_id`,`certified_at`);--> statement-breakpoint
ALTER TABLE `data_coverage` ADD COLUMN `feed` text;
