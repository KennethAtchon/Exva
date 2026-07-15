CREATE TABLE `paper_positions` (
	`broker_order_id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`venue` text NOT NULL,
	`instrument_symbol` text NOT NULL,
	`side` text NOT NULL,
	`shares` real NOT NULL,
	`entry_price` real NOT NULL,
	`size_usd` real NOT NULL,
	`open` integer DEFAULT true NOT NULL,
	`resting` integer DEFAULT false NOT NULL,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `broker_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_paper_positions_account_open` ON `paper_positions` (`account_id`,`open`);
