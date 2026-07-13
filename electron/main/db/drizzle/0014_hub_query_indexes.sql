-- Smoothness pass (doc 09): indexes for hub query patterns.
-- Documented from EXPLAIN QUERY PLAN on events feed + trades list.
CREATE INDEX IF NOT EXISTS `idx_trades_opened_at` ON `trades` (`opened_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_trades_closed_at` ON `trades` (`closed_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_trades_status_opened` ON `trades` (`status`,`opened_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_events_created_at` ON `events` (`created_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_events_session_created` ON `events` (`session_id`,`created_at`);
