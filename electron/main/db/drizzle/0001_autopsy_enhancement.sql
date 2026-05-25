ALTER TABLE `trade_autopsies` ADD COLUMN `summary_structured_json` text NOT NULL DEFAULT '{}';
--> statement-breakpoint
ALTER TABLE `trade_autopsies` ADD COLUMN `phase_traces_json` text NOT NULL DEFAULT '[]';
--> statement-breakpoint
ALTER TABLE `trade_autopsies` ADD COLUMN `quality_grade` text;
--> statement-breakpoint
ALTER TABLE `trade_autopsies` ADD COLUMN `quality_score` real;
--> statement-breakpoint
ALTER TABLE `trade_autopsies` ADD COLUMN `is_fallback` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
CREATE TABLE `autopsy_lessons` (
    `id` text PRIMARY KEY NOT NULL,
    `autopsy_id` text NOT NULL,
    `trade_id` text NOT NULL,
    `session_id` text NOT NULL,
    `lesson` text NOT NULL,
    `severity` text NOT NULL DEFAULT 'medium',
    `category` text NOT NULL DEFAULT 'strategy',
    `proposed_fix` text NOT NULL DEFAULT '',
    `status` text NOT NULL DEFAULT 'pending',
    `recurrence_count` integer NOT NULL DEFAULT 0,
    `created_at` text NOT NULL,
    `updated_at` text NOT NULL,
    `validated_at` text,
    FOREIGN KEY (`autopsy_id`) REFERENCES `trade_autopsies`(`id`) ON DELETE cascade,
    FOREIGN KEY (`trade_id`) REFERENCES `trades`(`id`) ON DELETE cascade,
    FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_autopsy_lessons_autopsy` ON `autopsy_lessons` (`autopsy_id`);
--> statement-breakpoint
CREATE INDEX `idx_autopsy_lessons_session` ON `autopsy_lessons` (`session_id`);
--> statement-breakpoint
CREATE INDEX `idx_autopsy_lessons_status` ON `autopsy_lessons` (`status`);
