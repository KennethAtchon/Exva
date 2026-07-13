-- Merge trade_autopsies + period_autopsies → autopsies (scope = trade|period).
-- Old period_autopsies.scope (global|session) moves to period_scope.
-- autopsy_lessons drops period_autopsy_id; single FK autopsy_id → autopsies.id.

CREATE TABLE `autopsies` (
	`id` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`trade_id` text,
	`summary` text,
	`period_scope` text,
	`window_start` text,
	`window_end` text,
	`filters_json` text,
	`trade_count` integer,
	`trade_ids_json` text,
	`total_cost_usd` real,
	`session_id` text,
	`model_id` text NOT NULL,
	`summary_structured_json` text DEFAULT '{}' NOT NULL,
	`phase_traces_json` text DEFAULT '[]' NOT NULL,
	`quality_grade` text,
	`quality_score` real,
	`is_fallback` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text DEFAULT 'user' NOT NULL,
	FOREIGN KEY (`trade_id`) REFERENCES `trades`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE set null,
	CHECK (`scope` IN ('trade', 'period'))
);--> statement-breakpoint
CREATE INDEX `idx_autopsies_scope` ON `autopsies` (`scope`);--> statement-breakpoint
CREATE INDEX `idx_autopsies_trade` ON `autopsies` (`trade_id`);--> statement-breakpoint
CREATE INDEX `idx_autopsies_period_scope` ON `autopsies` (`period_scope`);--> statement-breakpoint
CREATE INDEX `idx_autopsies_session` ON `autopsies` (`session_id`);--> statement-breakpoint
CREATE INDEX `idx_autopsies_created` ON `autopsies` (`created_at`);--> statement-breakpoint

INSERT INTO `autopsies` (
	`id`, `scope`, `trade_id`, `summary`,
	`period_scope`, `window_start`, `window_end`, `filters_json`,
	`trade_count`, `trade_ids_json`, `total_cost_usd`,
	`session_id`, `model_id`, `summary_structured_json`, `phase_traces_json`,
	`quality_grade`, `quality_score`, `is_fallback`, `created_at`, `created_by`
)
SELECT
	`id`, 'trade', `trade_id`, `summary`,
	NULL, NULL, NULL, NULL,
	NULL, NULL, NULL,
	`session_id`, `model_id`, `summary_structured_json`, `phase_traces_json`,
	`quality_grade`, `quality_score`, `is_fallback`, `created_at`, `created_by`
FROM `trade_autopsies`;--> statement-breakpoint

INSERT INTO `autopsies` (
	`id`, `scope`, `trade_id`, `summary`,
	`period_scope`, `window_start`, `window_end`, `filters_json`,
	`trade_count`, `trade_ids_json`, `total_cost_usd`,
	`session_id`, `model_id`, `summary_structured_json`, `phase_traces_json`,
	`quality_grade`, `quality_score`, `is_fallback`, `created_at`, `created_by`
)
SELECT
	`id`, 'period', NULL, NULL,
	`scope`, `window_start`, `window_end`, `filters_json`,
	`trade_count`, `trade_ids_json`, `total_cost_usd`,
	`session_id`, `model_id`, `summary_structured_json`, `phase_traces_json`,
	`quality_grade`, `quality_score`, `is_fallback`, `created_at`, `created_by`
FROM `period_autopsies`;--> statement-breakpoint

-- Assert trade-scoped count == old trade_autopsies count.
CREATE TEMP TABLE `_assert_autopsies_trade_count` (
	`ok` INTEGER NOT NULL CHECK (`ok` = 1)
);--> statement-breakpoint
INSERT INTO `_assert_autopsies_trade_count` (`ok`)
SELECT CASE
	WHEN (SELECT COUNT(*) FROM `autopsies` WHERE `scope` = 'trade')
	   = (SELECT COUNT(*) FROM `trade_autopsies`)
	THEN 1 ELSE 0
END;--> statement-breakpoint
DROP TABLE `_assert_autopsies_trade_count`;--> statement-breakpoint

-- Assert period-scoped count == old period_autopsies count.
CREATE TEMP TABLE `_assert_autopsies_period_count` (
	`ok` INTEGER NOT NULL CHECK (`ok` = 1)
);--> statement-breakpoint
INSERT INTO `_assert_autopsies_period_count` (`ok`)
SELECT CASE
	WHEN (SELECT COUNT(*) FROM `autopsies` WHERE `scope` = 'period')
	   = (SELECT COUNT(*) FROM `period_autopsies`)
	THEN 1 ELSE 0
END;--> statement-breakpoint
DROP TABLE `_assert_autopsies_period_count`;--> statement-breakpoint

CREATE TABLE `autopsy_lessons_new` (
	`id` text PRIMARY KEY NOT NULL,
	`autopsy_id` text,
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
	FOREIGN KEY (`autopsy_id`) REFERENCES `autopsies`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`trade_id`) REFERENCES `trades`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE set null
);--> statement-breakpoint

INSERT INTO `autopsy_lessons_new` (
	`id`, `autopsy_id`, `trade_id`, `session_id`,
	`lesson`, `severity`, `category`, `proposed_fix`,
	`status`, `recurrence_count`, `source`, `scope`,
	`created_at`, `updated_at`, `validated_at`
)
SELECT
	`id`,
	COALESCE(`autopsy_id`, `period_autopsy_id`),
	`trade_id`, `session_id`,
	`lesson`, `severity`, `category`, `proposed_fix`,
	`status`, `recurrence_count`, `source`, `scope`,
	`created_at`, `updated_at`, `validated_at`
FROM `autopsy_lessons`;--> statement-breakpoint

-- Assert lesson count preserved.
CREATE TEMP TABLE `_assert_autopsy_lessons_count` (
	`ok` INTEGER NOT NULL CHECK (`ok` = 1)
);--> statement-breakpoint
INSERT INTO `_assert_autopsy_lessons_count` (`ok`)
SELECT CASE
	WHEN (SELECT COUNT(*) FROM `autopsy_lessons_new`)
	   = (SELECT COUNT(*) FROM `autopsy_lessons`)
	THEN 1 ELSE 0
END;--> statement-breakpoint
DROP TABLE `_assert_autopsy_lessons_count`;--> statement-breakpoint

-- Assert every non-null autopsy_id resolves.
CREATE TEMP TABLE `_assert_autopsy_lessons_fk` (
	`ok` INTEGER NOT NULL CHECK (`ok` = 1)
);--> statement-breakpoint
INSERT INTO `_assert_autopsy_lessons_fk` (`ok`)
SELECT CASE
	WHEN NOT EXISTS (
		SELECT 1 FROM `autopsy_lessons_new` AS `l`
		WHERE `l`.`autopsy_id` IS NOT NULL
		  AND NOT EXISTS (
			SELECT 1 FROM `autopsies` AS `a` WHERE `a`.`id` = `l`.`autopsy_id`
		  )
	)
	THEN 1 ELSE 0
END;--> statement-breakpoint
DROP TABLE `_assert_autopsy_lessons_fk`;--> statement-breakpoint

DROP TABLE `autopsy_lessons`;--> statement-breakpoint
ALTER TABLE `autopsy_lessons_new` RENAME TO `autopsy_lessons`;--> statement-breakpoint
CREATE INDEX `idx_autopsy_lessons_autopsy` ON `autopsy_lessons` (`autopsy_id`);--> statement-breakpoint
CREATE INDEX `idx_autopsy_lessons_session` ON `autopsy_lessons` (`session_id`);--> statement-breakpoint
CREATE INDEX `idx_autopsy_lessons_status` ON `autopsy_lessons` (`status`);--> statement-breakpoint
CREATE INDEX `idx_autopsy_lessons_scope` ON `autopsy_lessons` (`scope`);--> statement-breakpoint

DROP TABLE `trade_autopsies`;--> statement-breakpoint
DROP TABLE `period_autopsies`;
