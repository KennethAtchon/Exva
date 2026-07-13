DROP TABLE `session_signal_sources`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_signal_events` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text,
	`source_type` text NOT NULL,
	`ticker` text NOT NULL,
	`company_name` text,
	`document_url` text,
	`accession_number` text,
	`payload_json` text DEFAULT '{}' NOT NULL,
	`filed_at` text NOT NULL,
	`detected_at` text NOT NULL,
	`dispatch_status` text NOT NULL,
	`dispatch_completed_at` text,
	`source_dropped_reason` text,
	`kind` text,
	`payload_v2` text,
	`dedupe_key` text,
	`ttl` text,
	`occurred_at` text,
	`origin_kind` text,
	`origin_id` text,
	`schedule_group_key` text
);
--> statement-breakpoint
INSERT INTO `__new_signal_events`("id", "source_id", "source_type", "ticker", "company_name", "document_url", "accession_number", "payload_json", "filed_at", "detected_at", "dispatch_status", "dispatch_completed_at", "source_dropped_reason", "kind", "payload_v2", "dedupe_key", "ttl", "occurred_at", "origin_kind", "origin_id", "schedule_group_key") SELECT "id", "source_id", "source_type", "ticker", "company_name", "document_url", "accession_number", "payload_json", "filed_at", "detected_at", "dispatch_status", "dispatch_completed_at", "source_dropped_reason", "kind", "payload_v2", "dedupe_key", "ttl", "occurred_at", "origin_kind", "origin_id", "schedule_group_key" FROM `signal_events`;--> statement-breakpoint
DROP TABLE `signal_events`;--> statement-breakpoint
ALTER TABLE `__new_signal_events` RENAME TO `signal_events`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_signal_events_source` ON `signal_events` (`source_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_signal_events_accession` ON `signal_events` (`source_id`,`accession_number`) WHERE "signal_events"."accession_number" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_signal_events_dedupe` ON `signal_events` (`source_id`,`dedupe_key`) WHERE "signal_events"."dedupe_key" is not null;--> statement-breakpoint
CREATE INDEX `idx_signal_events_origin` ON `signal_events` (`origin_kind`,`origin_id`);--> statement-breakpoint
CREATE TABLE `__new_session_signal_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`signal_event_id` text NOT NULL,
	`source_id` text,
	`queue_position_at_enqueue` integer NOT NULL,
	`status` text NOT NULL,
	`status_bucket` text NOT NULL,
	`enqueued_at` text NOT NULL,
	`started_at` text,
	`finished_at` text,
	`expires_at` text,
	`trade_id` text,
	`drop_reason` text,
	`notes_json` text,
	`subscription_id` text,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`signal_event_id`) REFERENCES `signal_events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_session_signal_deliveries`("id", "session_id", "signal_event_id", "source_id", "queue_position_at_enqueue", "status", "status_bucket", "enqueued_at", "started_at", "finished_at", "expires_at", "trade_id", "drop_reason", "notes_json", "subscription_id") SELECT "id", "session_id", "signal_event_id", "source_id", "queue_position_at_enqueue", "status", "status_bucket", "enqueued_at", "started_at", "finished_at", "expires_at", "trade_id", "drop_reason", "notes_json", "subscription_id" FROM `session_signal_deliveries`;--> statement-breakpoint
DROP TABLE `session_signal_deliveries`;--> statement-breakpoint
ALTER TABLE `__new_session_signal_deliveries` RENAME TO `session_signal_deliveries`;--> statement-breakpoint
CREATE INDEX `idx_ssd_session` ON `session_signal_deliveries` (`session_id`);--> statement-breakpoint
CREATE INDEX `idx_ssd_status` ON `session_signal_deliveries` (`session_id`,`status_bucket`);--> statement-breakpoint
CREATE INDEX `idx_ssd_subscription` ON `session_signal_deliveries` (`subscription_id`);--> statement-breakpoint
CREATE TABLE `__new_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`objective` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`is_focused` integer DEFAULT false NOT NULL,
	`selection_mode` text DEFAULT 'manual_shortlist' NOT NULL,
	`instrument_classes` text NOT NULL,
	`instrument_scope` text NOT NULL,
	`default_search_provider_id` text,
	`execution_mode` text DEFAULT 'paper_only' NOT NULL,
	`experience_id` text DEFAULT 'edgar-catalyst' NOT NULL,
	`strategy_config_json` text,
	`overrides_json` text,
	`live_readiness_acknowledged_at` text,
	`session_input_revision` integer DEFAULT 0 NOT NULL,
	`input_migration_state` text DEFAULT 'v2' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`default_search_provider_id`) REFERENCES `provider_accounts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_sessions`("id", "name", "objective", "status", "is_focused", "selection_mode", "instrument_classes", "instrument_scope", "default_search_provider_id", "execution_mode", "experience_id", "strategy_config_json", "overrides_json", "live_readiness_acknowledged_at", "session_input_revision", "input_migration_state", "created_at", "updated_at") SELECT "id", "name", "objective", "status", "is_focused", "selection_mode", "instrument_classes", "instrument_scope", "default_search_provider_id", "execution_mode", "experience_id", "strategy_config_json", "overrides_json", "live_readiness_acknowledged_at", "session_input_revision", "input_migration_state", "created_at", "updated_at" FROM `sessions`;--> statement-breakpoint
DROP TABLE `sessions`;--> statement-breakpoint
ALTER TABLE `__new_sessions` RENAME TO `sessions`;--> statement-breakpoint
CREATE INDEX `idx_sessions_status` ON `sessions` (`status`);--> statement-breakpoint
CREATE INDEX `idx_sessions_is_focused` ON `sessions` (`is_focused`);--> statement-breakpoint
ALTER TABLE `signal_sources` DROP COLUMN `experience_id`;--> statement-breakpoint
ALTER TABLE `signal_sources` DROP COLUMN `instrument_class`;--> statement-breakpoint
ALTER TABLE `signal_sources` DROP COLUMN `poll_cadence`;--> statement-breakpoint
ALTER TABLE `signal_sources` DROP COLUMN `analysis_timeframe`;--> statement-breakpoint
ALTER TABLE `signal_sources` DROP COLUMN `pipeline_id`;