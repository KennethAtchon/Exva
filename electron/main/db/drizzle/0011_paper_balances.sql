CREATE TABLE `paper_balances` (
	`account_id` text PRIMARY KEY NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`balance` real NOT NULL,
	`starting_balance` real NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `broker_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
