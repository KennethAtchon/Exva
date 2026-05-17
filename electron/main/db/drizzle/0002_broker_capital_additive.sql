ALTER TABLE `broker_accounts` ADD `max_sessions` integer DEFAULT 10 NOT NULL;
--> statement-breakpoint
ALTER TABLE `broker_accounts` ADD `allocation_enforcement` text DEFAULT 'hard' NOT NULL;
--> statement-breakpoint
ALTER TABLE `broker_accounts` ADD `balance_refresh_interval_min` integer DEFAULT 5 NOT NULL;
--> statement-breakpoint
ALTER TABLE `broker_accounts` ADD `balance_cache_usd` real;
--> statement-breakpoint
ALTER TABLE `broker_accounts` ADD `balance_cached_at` text;
--> statement-breakpoint
ALTER TABLE `session_broker_assignments` ADD `allocated_usd` real DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `workspace_preferences` ADD `allocation_enforcement_override` text;
