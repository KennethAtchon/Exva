CREATE TABLE `signal_source_polls` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`polled_at` text NOT NULL,
	`outcome` text NOT NULL,
	`http_status` integer,
	`detected` integer DEFAULT 0 NOT NULL,
	`passed` integer DEFAULT 0 NOT NULL,
	`dropped` integer DEFAULT 0 NOT NULL,
	`errors_json` text DEFAULT '[]' NOT NULL,
	`duration_ms` integer DEFAULT 0 NOT NULL,
	`status` text NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `signal_sources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_signal_source_polls_source_polled` ON `signal_source_polls` (`source_id`,`polled_at`);--> statement-breakpoint
CREATE TABLE `signal_source_runtime_states` (
	`source_id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`last_poll_at` text,
	`last_success_at` text,
	`consecutive_failures` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`last_outcome` text,
	`http_status` integer,
	`detected` integer DEFAULT 0 NOT NULL,
	`passed` integer DEFAULT 0 NOT NULL,
	`dropped` integer DEFAULT 0 NOT NULL,
	`errors_json` text DEFAULT '[]' NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `signal_sources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `schedule_runtime_states` ADD `last_scan_summary_json` text DEFAULT '{}' NOT NULL;