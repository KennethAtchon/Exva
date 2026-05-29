CREATE TABLE `cik_ticker_cache` (
	`cik` text PRIMARY KEY NOT NULL,
	`ticker` text,
	`looked_up_at` text NOT NULL
);
