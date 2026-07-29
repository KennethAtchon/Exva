-- Trading recovery tables (Solutions 01–08). Additive only.

ALTER TABLE `trades` ADD COLUMN `origin_kind` text NOT NULL DEFAULT 'strategy';--> statement-breakpoint
ALTER TABLE `backtest_runs` ADD COLUMN `engine_version` integer;--> statement-breakpoint
ALTER TABLE `backtest_runs` ADD COLUMN `spec_hash` text;--> statement-breakpoint
ALTER TABLE `backtest_runs` ADD COLUMN `dataset_hash` text;--> statement-breakpoint
ALTER TABLE `backtest_runs` ADD COLUMN `research_contract_hash` text;--> statement-breakpoint
CREATE TABLE `paper_certification_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`broker_account_id` text NOT NULL,
	`symbol` text DEFAULT 'SPY' NOT NULL,
	`notional_usd` real DEFAULT 10 NOT NULL,
	`status` text NOT NULL,
	`entry_client_order_id` text NOT NULL,
	`entry_wire_client_order_id` text,
	`entry_broker_order_id` text,
	`exit_client_order_id` text,
	`exit_wire_client_order_id` text,
	`exit_broker_order_id` text,
	`filled_quantity` real DEFAULT 0 NOT NULL,
	`failure_code` text,
	`failure_message` text,
	`armed_at` text NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`broker_account_id`) REFERENCES `broker_accounts`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
CREATE INDEX `idx_paper_cert_account_armed` ON `paper_certification_runs` (`broker_account_id`,`armed_at`);--> statement-breakpoint
CREATE TABLE `order_intents` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`signal_id` text,
	`origin_kind` text DEFAULT 'strategy' NOT NULL,
	`broker_account_id` text NOT NULL,
	`canonical_client_order_id` text NOT NULL,
	`wire_client_order_id` text NOT NULL,
	`status` text NOT NULL,
	`side` text NOT NULL,
	`symbol` text NOT NULL,
	`notional_usd` real,
	`quantity` real,
	`broker_order_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`broker_account_id`) REFERENCES `broker_accounts`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_order_intents_client` ON `order_intents` (`broker_account_id`,`canonical_client_order_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_order_intents_wire` ON `order_intents` (`broker_account_id`,`wire_client_order_id`);--> statement-breakpoint
CREATE TABLE `broker_order_events` (
	`id` text PRIMARY KEY NOT NULL,
	`order_intent_id` text NOT NULL,
	`broker_order_id` text,
	`status` text NOT NULL,
	`raw_status` text,
	`payload_json` text DEFAULT '{}' NOT NULL,
	`occurred_at` text NOT NULL,
	FOREIGN KEY (`order_intent_id`) REFERENCES `order_intents`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
CREATE INDEX `idx_broker_order_events_intent` ON `broker_order_events` (`order_intent_id`);--> statement-breakpoint
CREATE TABLE `broker_fills` (
	`id` text PRIMARY KEY NOT NULL,
	`order_intent_id` text NOT NULL,
	`broker_order_id` text NOT NULL,
	`quantity` real NOT NULL,
	`price` real NOT NULL,
	`fee_usd` real DEFAULT 0 NOT NULL,
	`filled_at` text NOT NULL,
	FOREIGN KEY (`order_intent_id`) REFERENCES `order_intents`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
CREATE INDEX `idx_broker_fills_intent` ON `broker_fills` (`order_intent_id`);--> statement-breakpoint
CREATE TABLE `cycle_funnel_outcomes` (
	`cycle_id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`input_id` text,
	`origin_kind` text DEFAULT 'strategy' NOT NULL,
	`terminal_stage` text NOT NULL,
	`outcome` text NOT NULL,
	`reason_code` text NOT NULL,
	`detail_json` text DEFAULT '{}' NOT NULL,
	`occurred_at` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
CREATE INDEX `idx_cycle_funnel_session` ON `cycle_funnel_outcomes` (`session_id`,`occurred_at`);--> statement-breakpoint
CREATE TABLE `session_uptime_days` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`day_key` text NOT NULL,
	`eligible_window_minutes` real DEFAULT 0 NOT NULL,
	`live_minutes` real DEFAULT 0 NOT NULL,
	`coverage_pct` real DEFAULT 0 NOT NULL,
	`first_eligible_scan_at` text,
	`minutes_late_at_open` real,
	`unplanned_stops` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_session_uptime_day` ON `session_uptime_days` (`session_id`,`day_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_ssd_subscription_event` ON `session_signal_deliveries` (`subscription_id`,`signal_event_id`) WHERE `subscription_id` IS NOT NULL;
