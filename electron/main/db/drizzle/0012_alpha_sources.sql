CREATE TABLE `cross_venue_market_links` (
	`id` text PRIMARY KEY NOT NULL,
	`polymarket_id` text NOT NULL,
	`kalshi_ticker` text NOT NULL,
	`confidence` real NOT NULL,
	`approved` integer DEFAULT false NOT NULL,
	`question_polymarket` text,
	`question_kalshi` text,
	`resolution_date` text,
	`match_method` text DEFAULT 'manual' NOT NULL,
	`notes` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_cross_venue_pair` ON `cross_venue_market_links` (`polymarket_id`,`kalshi_ticker`);
--> statement-breakpoint
CREATE INDEX `idx_cross_venue_approved` ON `cross_venue_market_links` (`approved`);
--> statement-breakpoint
CREATE TABLE `funding_rates` (
	`id` text PRIMARY KEY NOT NULL,
	`venue` text NOT NULL,
	`symbol` text NOT NULL,
	`ts` text NOT NULL,
	`rate` real NOT NULL,
	`ingested_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_funding_rates_venue_symbol_ts` ON `funding_rates` (`venue`,`symbol`,`ts`);
--> statement-breakpoint
CREATE INDEX `idx_funding_rates_symbol_ts` ON `funding_rates` (`symbol`,`ts`);
--> statement-breakpoint
CREATE TABLE `calendar_events` (
	`id` text PRIMARY KEY NOT NULL,
	`event_type` text NOT NULL,
	`scheduled_at` text NOT NULL,
	`symbol` text,
	`title` text,
	`source` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_calendar_events_scheduled` ON `calendar_events` (`scheduled_at`);
--> statement-breakpoint
CREATE INDEX `idx_calendar_events_symbol_scheduled` ON `calendar_events` (`symbol`,`scheduled_at`);
--> statement-breakpoint
CREATE TABLE `form4_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`accession_number` text NOT NULL,
	`cik` text NOT NULL,
	`ticker` text,
	`company_name` text,
	`insider_name` text NOT NULL,
	`role` text NOT NULL,
	`transaction_code` text NOT NULL,
	`shares` real NOT NULL,
	`price_per_share` real,
	`total_value_usd` real,
	`is_open_market_buy` integer NOT NULL,
	`filed_at` text NOT NULL,
	`transaction_date` text NOT NULL,
	`document_url` text,
	`ingested_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_form4_accession_insider` ON `form4_transactions` (`accession_number`,`insider_name`,`transaction_code`,`transaction_date`);
--> statement-breakpoint
CREATE INDEX `idx_form4_ticker_filed` ON `form4_transactions` (`ticker`,`filed_at`);
