CREATE TABLE `briefings` (
	`date` text PRIMARY KEY NOT NULL,
	`doc_json` text NOT NULL,
	`narrative` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `equity_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`ts` text NOT NULL,
	`total` real NOT NULL,
	`per_account_json` text DEFAULT '{}' NOT NULL,
	`per_experience_json` text DEFAULT '{}' NOT NULL,
	`ai_spend_usd` real DEFAULT 0 NOT NULL,
	`marks_stale` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_equity_snapshots_ts` ON `equity_snapshots` (`ts`);
