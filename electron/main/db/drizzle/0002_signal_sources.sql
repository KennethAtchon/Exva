CREATE TABLE `signal_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL CHECK(`type` IN ('edgar_8k', 'web_search', 'manual')),
	`name` text NOT NULL,
	`description` text,
	`enabled` integer DEFAULT true NOT NULL,
	`config_json` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `signal_events` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`source_type` text NOT NULL,
	`ticker` text NOT NULL,
	`company_name` text,
	`document_url` text,
	`accession_number` text,
	`payload_json` text DEFAULT '{}' NOT NULL,
	`filed_at` text NOT NULL,
	`detected_at` text NOT NULL,
	`dispatch_status` text NOT NULL CHECK(`dispatch_status` IN ('new', 'fanned_out', 'dropped_pre_fanout')),
	`dispatch_completed_at` text,
	`source_dropped_reason` text,
	FOREIGN KEY (`source_id`) REFERENCES `signal_sources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_signal_events_source` ON `signal_events` (`source_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_signal_events_accession` ON `signal_events` (`source_id`,`accession_number`) WHERE `accession_number` IS NOT NULL;
--> statement-breakpoint
CREATE TABLE `session_signal_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`signal_event_id` text NOT NULL,
	`source_id` text NOT NULL,
	`queue_position_at_enqueue` integer NOT NULL,
	`status` text NOT NULL CHECK(`status` IN ('queued', 'waiting_for_resume', 'processing', 'triggered', 'traded', 'rejected', 'dropped', 'expired')),
	`status_bucket` text NOT NULL CHECK(`status_bucket` IN ('pending', 'completed', 'dropped')),
	`enqueued_at` text NOT NULL,
	`started_at` text,
	`finished_at` text,
	`expires_at` text,
	`trade_id` text,
	`drop_reason` text,
	`notes_json` text,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`signal_event_id`) REFERENCES `signal_events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_ssd_session` ON `session_signal_deliveries` (`session_id`);
--> statement-breakpoint
CREATE INDEX `idx_ssd_status` ON `session_signal_deliveries` (`session_id`,`status_bucket`);
--> statement-breakpoint
CREATE TABLE `session_signal_sources` (
	`session_id` text NOT NULL,
	`source_id` text NOT NULL,
	PRIMARY KEY(`session_id`, `source_id`),
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `signal_sources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `session_research_posture_new` (
	`session_id` text PRIMARY KEY NOT NULL,
	`posture_preset_id` text DEFAULT 'custom' NOT NULL,
	`processing_mode` text DEFAULT 'manual' NOT NULL,
	`evidence_mode` text DEFAULT 'balanced' NOT NULL,
	`catalyst_mode` text DEFAULT 'preferred' NOT NULL,
	`fundamental_strictness` text DEFAULT 'balanced' NOT NULL,
	`posture_notes` text DEFAULT '' NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `session_research_posture_new` (
	`session_id`,
	`posture_preset_id`,
	`processing_mode`,
	`evidence_mode`,
	`catalyst_mode`,
	`fundamental_strictness`,
	`posture_notes`,
	`updated_at`
)
SELECT
	`session_id`,
	`posture_preset_id`,
	CASE `discovery_mode`
		WHEN 'event_contract_scan' THEN 'contract'
		WHEN 'custom' THEN 'manual'
		ELSE 'catalyst'
	END AS `processing_mode`,
	`evidence_mode`,
	`catalyst_mode`,
	`fundamental_strictness`,
	`posture_notes`,
	`updated_at`
FROM `session_research_posture`;
--> statement-breakpoint
DROP TABLE `session_research_posture`;
--> statement-breakpoint
ALTER TABLE `session_research_posture_new` RENAME TO `session_research_posture`;
