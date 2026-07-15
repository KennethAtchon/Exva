CREATE TABLE IF NOT EXISTS `data_coverage` (
	`id` text PRIMARY KEY NOT NULL,
	`symbol` text NOT NULL,
	`timeframe` text NOT NULL,
	`first_ts` text NOT NULL,
	`last_ts` text NOT NULL,
	`provider` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_data_coverage_symbol_tf` ON `data_coverage` (`symbol`,`timeframe`);--> statement-breakpoint
CREATE TABLE `experience_input_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`template_id` text NOT NULL,
	`template_version` integer NOT NULL,
	`mode` text NOT NULL,
	`name` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`payload_json` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_experience_input_profiles_template` ON `experience_input_profiles` (`template_id`,`template_version`);--> statement-breakpoint
CREATE TABLE `experience_template_revisions` (
	`template_id` text NOT NULL,
	`version` integer NOT NULL,
	`status` text NOT NULL,
	`display_name` text NOT NULL,
	`description` text NOT NULL,
	`pipeline_id` text NOT NULL,
	`strategy_id` text,
	`prompt_variant_key` text NOT NULL,
	`broker_requirement` text NOT NULL,
	`input_contract_json` text NOT NULL,
	`default_preset_ids_json` text NOT NULL,
	`research_contract_json` text NOT NULL,
	`universe_policy` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`template_id`, `version`),
	FOREIGN KEY (`template_id`) REFERENCES `experience_templates`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_experience_template_revisions_status` ON `experience_template_revisions` (`template_id`,`status`);--> statement-breakpoint
CREATE TABLE `experience_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `instrument_set_members` (
	`set_id` text NOT NULL,
	`set_revision` integer NOT NULL,
	`canonical_id` text NOT NULL,
	`display_symbol` text NOT NULL,
	`venue` text,
	PRIMARY KEY(`set_id`, `set_revision`, `canonical_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_instrument_set_members_set_rev` ON `instrument_set_members` (`set_id`,`set_revision`);--> statement-breakpoint
CREATE TABLE `instrument_set_revisions` (
	`set_id` text NOT NULL,
	`revision` integer NOT NULL,
	`status` text NOT NULL,
	`name` text NOT NULL,
	`instrument_class` text NOT NULL,
	`mode` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`set_id`, `revision`),
	FOREIGN KEY (`set_id`) REFERENCES `instrument_sets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_instrument_set_revisions_status` ON `instrument_set_revisions` (`set_id`,`status`);--> statement-breakpoint
CREATE TABLE `instrument_sets` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `migration_quarantine` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`session_id` text,
	`source_id` text,
	`reason` text NOT NULL,
	`detail_json` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `ohlcv_bars` (
	`id` text PRIMARY KEY NOT NULL,
	`symbol` text NOT NULL,
	`instrument_class` text NOT NULL,
	`timeframe` text NOT NULL,
	`ts` text NOT NULL,
	`open` real NOT NULL,
	`high` real NOT NULL,
	`low` real NOT NULL,
	`close` real NOT NULL,
	`volume` real,
	`provider` text NOT NULL,
	`ingested_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_ohlcv_bars_symbol_tf_ts` ON `ohlcv_bars` (`symbol`,`timeframe`,`ts`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_ohlcv_bars_symbol_tf` ON `ohlcv_bars` (`symbol`,`timeframe`);--> statement-breakpoint
CREATE TABLE `schedule_runtime_states` (
	`group_key` text PRIMARY KEY NOT NULL,
	`next_run_at` text,
	`last_started_at` text,
	`last_finished_at` text,
	`last_success_at` text,
	`last_duration_ms` integer,
	`consecutive_failures` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`subscription_ids_json` text DEFAULT '[]' NOT NULL,
	`instrument_count` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `session_input_subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`template_id` text NOT NULL,
	`template_version` integer NOT NULL,
	`mode` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_from_profile_id` text,
	`revision` integer DEFAULT 1 NOT NULL,
	`source_definition_id` text,
	`source_revision` integer,
	`instrument_set_id` text,
	`instrument_set_revision` integer,
	`cadence_json` text,
	`analysis_timeframe` text NOT NULL,
	`market_calendar_id` text,
	`strategy_parameters_json` text,
	`filters_json` text,
	`uses_unvalidated_universe` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_session_input_subscriptions_session` ON `session_input_subscriptions` (`session_id`);--> statement-breakpoint
CREATE INDEX `idx_session_input_subscriptions_source` ON `session_input_subscriptions` (`source_definition_id`,`enabled`);--> statement-breakpoint
CREATE INDEX `idx_session_input_subscriptions_set` ON `session_input_subscriptions` (`instrument_set_id`,`enabled`);--> statement-breakpoint
CREATE TABLE `source_definition_revisions` (
	`source_definition_id` text NOT NULL,
	`revision` integer NOT NULL,
	`config_json` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`source_definition_id`, `revision`),
	FOREIGN KEY (`source_definition_id`) REFERENCES `source_definitions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `source_definitions` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`enabled` integer DEFAULT true NOT NULL,
	`integration_id` text,
	`output_contract_id` text NOT NULL,
	`config_schema_version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `session_signal_deliveries` ADD `subscription_id` text;--> statement-breakpoint
CREATE INDEX `idx_ssd_subscription` ON `session_signal_deliveries` (`subscription_id`);--> statement-breakpoint
ALTER TABLE `sessions` ADD `session_input_revision` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `sessions` ADD `input_migration_state` text DEFAULT 'v1' NOT NULL;--> statement-breakpoint
ALTER TABLE `signal_events` ADD `origin_kind` text;--> statement-breakpoint
ALTER TABLE `signal_events` ADD `origin_id` text;--> statement-breakpoint
ALTER TABLE `signal_events` ADD `schedule_group_key` text;--> statement-breakpoint
CREATE INDEX `idx_signal_events_origin` ON `signal_events` (`origin_kind`,`origin_id`);