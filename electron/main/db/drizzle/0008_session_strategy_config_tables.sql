-- Session strategy config diet: create unified tables (no data move).
-- Backfill of sessions/presets is applied programmatically after migrate+seed
-- (see session-strategy-config-backfill.ts / migration 0009 marker).

CREATE TABLE `session_strategy_configs` (
	`session_id` text PRIMARY KEY NOT NULL,
	`version` integer NOT NULL,
	`schema_version` integer NOT NULL,
	`doc` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint

CREATE TABLE `config_presets` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`doc` text NOT NULL,
	`builtin` integer DEFAULT false NOT NULL,
	`updated_at` text NOT NULL
);--> statement-breakpoint

CREATE TABLE `session_strategy_config_history` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`version` integer NOT NULL,
	`doc` text NOT NULL,
	`saved_at` text NOT NULL
);
