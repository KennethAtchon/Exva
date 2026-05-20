CREATE TABLE `developer_settings` (
	`id` text PRIMARY KEY NOT NULL DEFAULT 'singleton',
	`default_event_min_level` text DEFAULT 'INFO' NOT NULL,
	`default_time_window_minutes` integer DEFAULT 60 NOT NULL,
	`default_source_filters_json` text DEFAULT '[]' NOT NULL,
	`include_prompts_in_exports` integer DEFAULT 0 NOT NULL,
	`include_tool_payloads_in_exports` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `runtime_log_overrides` (
	`id` text PRIMARY KEY NOT NULL,
	`scope_type` text NOT NULL,
	`scope_id` text,
	`main_log_level` text NOT NULL,
	`event_min_level` text NOT NULL,
	`expires_at` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_events_scope_created` ON `events` (`session_id`, `cycle_id`, `created_at`);
--> statement-breakpoint
CREATE INDEX `idx_events_level_created` ON `events` (`level`, `created_at`);
--> statement-breakpoint
CREATE INDEX `idx_api_call_log_scope_created` ON `api_call_log` (`session_id`, `cycle_id`, `trade_id`, `created_at`);
