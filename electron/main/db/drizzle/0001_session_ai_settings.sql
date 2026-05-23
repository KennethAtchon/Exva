CREATE TABLE `session_ai_settings` (
	`session_id` text PRIMARY KEY NOT NULL,
	`worker_guidance_markdown` text DEFAULT '' NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `session_ai_settings` (`session_id`, `worker_guidance_markdown`, `updated_at`)
SELECT `id`, '', datetime('now') FROM `sessions`;
