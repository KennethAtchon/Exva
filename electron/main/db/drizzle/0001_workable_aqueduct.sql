CREATE TABLE `session_activity` (
	`session_id` text PRIMARY KEY NOT NULL,
	`activity` text NOT NULL,
	`conditions_json` text DEFAULT '[]' NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `session_activity_transitions` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`activity` text NOT NULL,
	`conditions_json` text DEFAULT '[]' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_session_activity_transitions_session` ON `session_activity_transitions` (`session_id`,`created_at`);