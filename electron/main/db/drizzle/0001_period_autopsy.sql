CREATE TABLE `period_autopsies` (
	`id` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`session_id` text,
	`window_start` text NOT NULL,
	`window_end` text NOT NULL,
	`model_id` text NOT NULL,
	`filters_json` text DEFAULT '{}' NOT NULL,
	`trade_count` integer DEFAULT 0 NOT NULL,
	`trade_ids_json` text DEFAULT '[]' NOT NULL,
	`summary_structured_json` text DEFAULT '{}' NOT NULL,
	`phase_traces_json` text DEFAULT '[]' NOT NULL,
	`quality_grade` text,
	`quality_score` real,
	`is_fallback` integer DEFAULT false NOT NULL,
	`total_cost_usd` real DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text DEFAULT 'user' NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_period_autopsies_scope` ON `period_autopsies` (`scope`);--> statement-breakpoint
CREATE INDEX `idx_period_autopsies_session` ON `period_autopsies` (`session_id`);--> statement-breakpoint
CREATE INDEX `idx_period_autopsies_created` ON `period_autopsies` (`created_at`);--> statement-breakpoint
CREATE TABLE `autopsy_lessons_new` (
	`id` text PRIMARY KEY NOT NULL,
	`autopsy_id` text,
	`period_autopsy_id` text,
	`trade_id` text,
	`session_id` text,
	`lesson` text NOT NULL,
	`severity` text DEFAULT 'medium' NOT NULL,
	`category` text DEFAULT 'strategy' NOT NULL,
	`proposed_fix` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`recurrence_count` integer DEFAULT 0 NOT NULL,
	`source` text DEFAULT 'trade' NOT NULL,
	`scope` text DEFAULT 'session' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`validated_at` text,
	FOREIGN KEY (`autopsy_id`) REFERENCES `trade_autopsies`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`period_autopsy_id`) REFERENCES `period_autopsies`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`trade_id`) REFERENCES `trades`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `autopsy_lessons_new` (
	`id`,
	`autopsy_id`,
	`period_autopsy_id`,
	`trade_id`,
	`session_id`,
	`lesson`,
	`severity`,
	`category`,
	`proposed_fix`,
	`status`,
	`recurrence_count`,
	`source`,
	`scope`,
	`created_at`,
	`updated_at`,
	`validated_at`
)
SELECT
	`id`,
	`autopsy_id`,
	NULL,
	`trade_id`,
	`session_id`,
	`lesson`,
	`severity`,
	`category`,
	`proposed_fix`,
	`status`,
	`recurrence_count`,
	'trade',
	'session',
	`created_at`,
	`updated_at`,
	`validated_at`
FROM `autopsy_lessons`;
--> statement-breakpoint
DROP TABLE `autopsy_lessons`;--> statement-breakpoint
ALTER TABLE `autopsy_lessons_new` RENAME TO `autopsy_lessons`;--> statement-breakpoint
CREATE INDEX `idx_autopsy_lessons_autopsy` ON `autopsy_lessons` (`autopsy_id`);--> statement-breakpoint
CREATE INDEX `idx_autopsy_lessons_period` ON `autopsy_lessons` (`period_autopsy_id`);--> statement-breakpoint
CREATE INDEX `idx_autopsy_lessons_session` ON `autopsy_lessons` (`session_id`);--> statement-breakpoint
CREATE INDEX `idx_autopsy_lessons_status` ON `autopsy_lessons` (`status`);--> statement-breakpoint
CREATE INDEX `idx_autopsy_lessons_scope` ON `autopsy_lessons` (`scope`);
