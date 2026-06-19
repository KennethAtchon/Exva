CREATE TABLE `decision_traces` (
	`cycle_id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`trade_id` text,
	`instrument_symbol` text NOT NULL,
	`trace_json` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`trade_id`) REFERENCES `trades`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_decision_traces_session` ON `decision_traces` (`session_id`);--> statement-breakpoint
CREATE INDEX `idx_decision_traces_trade` ON `decision_traces` (`trade_id`);