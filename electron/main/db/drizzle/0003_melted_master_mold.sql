CREATE TABLE `backtest_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`experience_id` text NOT NULL,
	`model_version_id` text,
	`contract_hash` text NOT NULL,
	`window_start` text NOT NULL,
	`window_end` text NOT NULL,
	`fold_config_json` text NOT NULL,
	`cost_model_json` text NOT NULL,
	`metrics_json` text NOT NULL,
	`verdict` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_backtest_runs_experience` ON `backtest_runs` (`experience_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `model_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`experience_id` text NOT NULL,
	`model_kind` text NOT NULL,
	`feature_schema_json` text NOT NULL,
	`training_window_start` text NOT NULL,
	`training_window_end` text NOT NULL,
	`calibration_json` text DEFAULT '{}' NOT NULL,
	`artifact_uri` text,
	`checksum` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_model_versions_experience` ON `model_versions` (`experience_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `promotion_decisions` (
	`id` text PRIMARY KEY NOT NULL,
	`experience_id` text NOT NULL,
	`model_version_id` text,
	`from_tier` text NOT NULL,
	`to_tier` text NOT NULL,
	`decision` text NOT NULL,
	`evidence_json` text NOT NULL,
	`decided_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_promotion_decisions_experience` ON `promotion_decisions` (`experience_id`,`decided_at`);--> statement-breakpoint
CREATE TABLE `signal_labels` (
	`observation_id` text NOT NULL,
	`horizon` text NOT NULL,
	`benchmark` text NOT NULL,
	`gross_return_bps` real,
	`cost_bps` real,
	`net_return_bps` real,
	`benchmark_return_bps` real,
	`max_favorable_bps` real,
	`max_adverse_bps` real,
	`outcome_win` integer,
	`label_ready_at` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`observation_id`, `horizon`, `benchmark`),
	FOREIGN KEY (`observation_id`) REFERENCES `signal_observations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `signal_observations` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text,
	`experience_id` text NOT NULL,
	`signal_id` text NOT NULL,
	`cycle_id` text,
	`instrument_symbol` text NOT NULL,
	`instrument_class` text NOT NULL,
	`action` text NOT NULL,
	`event_time` text NOT NULL,
	`observed_at` text NOT NULL,
	`source_uri` text,
	`feature_json` text DEFAULT '{}' NOT NULL,
	`decision_json` text,
	`model_version` text,
	`label_horizon` text NOT NULL,
	`label_benchmark` text NOT NULL,
	`reference_price` real,
	`label_ready_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_signal_observations_experience` ON `signal_observations` (`experience_id`,`event_time`);--> statement-breakpoint
CREATE INDEX `idx_signal_observations_session` ON `signal_observations` (`session_id`);--> statement-breakpoint
CREATE INDEX `idx_signal_observations_label_ready` ON `signal_observations` (`label_ready_at`);