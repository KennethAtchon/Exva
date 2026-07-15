ALTER TABLE `signal_events` ADD COLUMN `kind` text;
--> statement-breakpoint
ALTER TABLE `signal_events` ADD COLUMN `payload_v2` text;
--> statement-breakpoint
ALTER TABLE `signal_events` ADD COLUMN `dedupe_key` text;
--> statement-breakpoint
ALTER TABLE `signal_events` ADD COLUMN `ttl` text;
--> statement-breakpoint
ALTER TABLE `signal_events` ADD COLUMN `occurred_at` text;
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_signal_events_dedupe` ON `signal_events` (`source_id`,`dedupe_key`) WHERE `dedupe_key` is not null;
--> statement-breakpoint
UPDATE `signal_events` SET
  `kind` = CASE
    WHEN `source_type` = 'edgar_8k' THEN 'filing'
    WHEN `source_type` = 'prediction_event' THEN 'market_dislocation'
    WHEN `source_type` = 'timer' THEN 'scan_hit'
    WHEN `source_type` = 'manual' THEN 'manual'
    WHEN `source_type` = 'mock' THEN 'manual'
    ELSE 'manual'
  END,
  `dedupe_key` = COALESCE(`accession_number`, `id`),
  `ttl` = 'PT4H',
  `occurred_at` = COALESCE(`filed_at`, `detected_at`)
WHERE `kind` IS NULL;
--> statement-breakpoint
CREATE TABLE `ohlcv_bars` (
  `id` text PRIMARY KEY NOT NULL,
  `symbol` text NOT NULL,
  `instrument_class` text NOT NULL,
  `timeframe` text NOT NULL,
  `ts` text NOT NULL,
  `open` real NOT NULL,
  `high` real NOT NULL,
  `low` real NOT NULL,
  `close` real NOT NULL,
  `volume` real,
  `provider` text NOT NULL,
  `ingested_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_ohlcv_bars_symbol_tf_ts` ON `ohlcv_bars` (`symbol`,`timeframe`,`ts`);
--> statement-breakpoint
CREATE INDEX `idx_ohlcv_bars_symbol_tf` ON `ohlcv_bars` (`symbol`,`timeframe`);
--> statement-breakpoint
CREATE TABLE `data_coverage` (
  `id` text PRIMARY KEY NOT NULL,
  `symbol` text NOT NULL,
  `timeframe` text NOT NULL,
  `first_ts` text NOT NULL,
  `last_ts` text NOT NULL,
  `provider` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_data_coverage_symbol_tf` ON `data_coverage` (`symbol`,`timeframe`);
