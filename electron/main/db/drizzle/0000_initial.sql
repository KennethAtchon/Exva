CREATE TABLE `agent_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_run_id` text NOT NULL,
	`session_id` text NOT NULL,
	`trade_id` text,
	`cycle_id` text,
	`role` text NOT NULL,
	`provider_key` text NOT NULL,
	`model_id` text NOT NULL,
	`messages_json` text NOT NULL,
	`thinking_json` text,
	`tool_calls_json` text,
	`output_json` text,
	`output_schema_name` text,
	`parse_fallback` integer DEFAULT 0 NOT NULL,
	`strategy_snapshot_json` text NOT NULL,
	`market_snapshot_json` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`agent_run_id`) REFERENCES `agent_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`trade_id`) REFERENCES `trades`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_agent_messages_run` ON `agent_messages` (`agent_run_id`);--> statement-breakpoint
CREATE INDEX `idx_agent_messages_trade` ON `agent_messages` (`trade_id`);--> statement-breakpoint
CREATE TABLE `agent_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`trade_id` text,
	`agent_type` text NOT NULL,
	`model` text NOT NULL,
	`provider_key` text DEFAULT 'unknown' NOT NULL,
	`finish_reason` text DEFAULT 'stop' NOT NULL,
	`input_tokens` integer NOT NULL,
	`output_tokens` integer NOT NULL,
	`cost_usd` real NOT NULL,
	`output_text` text NOT NULL,
	`duration_ms` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`trade_id`) REFERENCES `trades`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_agent_runs_session` ON `agent_runs` (`session_id`);--> statement-breakpoint
CREATE TABLE `api_call_log` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text,
	`trade_id` text,
	`cycle_id` text,
	`provider` text NOT NULL,
	`endpoint` text NOT NULL,
	`call_type` text NOT NULL,
	`credits_used` integer,
	`cost_usd` real,
	`latency_ms` integer NOT NULL,
	`status` text NOT NULL,
	`from_cache` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`trade_id`) REFERENCES `trades`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_api_call_log_session` ON `api_call_log` (`session_id`);--> statement-breakpoint
CREATE INDEX `idx_api_call_log_created` ON `api_call_log` (`created_at`);--> statement-breakpoint
CREATE TABLE `autopsies` (
	`id` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`trade_id` text,
	`summary` text,
	`period_scope` text,
	`window_start` text,
	`window_end` text,
	`filters_json` text,
	`trade_count` integer,
	`trade_ids_json` text,
	`total_cost_usd` real,
	`session_id` text,
	`model_id` text NOT NULL,
	`summary_structured_json` text DEFAULT '{}' NOT NULL,
	`phase_traces_json` text DEFAULT '[]' NOT NULL,
	`quality_grade` text,
	`quality_score` real,
	`is_fallback` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text DEFAULT 'user' NOT NULL,
	FOREIGN KEY (`trade_id`) REFERENCES `trades`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "autopsies_scope_check" CHECK("autopsies"."scope" IN ('trade', 'period'))
);
--> statement-breakpoint
CREATE INDEX `idx_autopsies_scope` ON `autopsies` (`scope`);--> statement-breakpoint
CREATE INDEX `idx_autopsies_trade` ON `autopsies` (`trade_id`);--> statement-breakpoint
CREATE INDEX `idx_autopsies_period_scope` ON `autopsies` (`period_scope`);--> statement-breakpoint
CREATE INDEX `idx_autopsies_session` ON `autopsies` (`session_id`);--> statement-breakpoint
CREATE INDEX `idx_autopsies_created` ON `autopsies` (`created_at`);--> statement-breakpoint
CREATE TABLE `autopsy_lessons` (
	`id` text PRIMARY KEY NOT NULL,
	`autopsy_id` text,
	`trade_id` text,
	`session_id` text,
	`lesson` text NOT NULL,
	`severity` text DEFAULT 'medium' NOT NULL,
	`category` text DEFAULT 'strategy' NOT NULL,
	`proposed_fix` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`recurrence_count` integer DEFAULT 0 NOT NULL,
	`source` text DEFAULT 'trade' NOT NULL,
	`scope` text DEFAULT 'session' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`validated_at` text,
	FOREIGN KEY (`autopsy_id`) REFERENCES `autopsies`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`trade_id`) REFERENCES `trades`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_autopsy_lessons_autopsy` ON `autopsy_lessons` (`autopsy_id`);--> statement-breakpoint
CREATE INDEX `idx_autopsy_lessons_session` ON `autopsy_lessons` (`session_id`);--> statement-breakpoint
CREATE INDEX `idx_autopsy_lessons_status` ON `autopsy_lessons` (`status`);--> statement-breakpoint
CREATE INDEX `idx_autopsy_lessons_scope` ON `autopsy_lessons` (`scope`);--> statement-breakpoint
CREATE TABLE `backtest_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`experience_id` text NOT NULL,
	`model_version_id` text,
	`contract_hash` text NOT NULL,
	`window_start` text NOT NULL,
	`window_end` text NOT NULL,
	`fold_config_json` text NOT NULL,
	`cost_model_json` text NOT NULL,
	`metrics_json` text NOT NULL,
	`verdict` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_backtest_runs_experience` ON `backtest_runs` (`experience_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `briefings` (
	`date` text PRIMARY KEY NOT NULL,
	`doc_json` text NOT NULL,
	`narrative` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `broker_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`broker_type` text NOT NULL,
	`supported_instrument_classes` text NOT NULL,
	`mode` text DEFAULT 'paper' NOT NULL,
	`max_sessions` integer DEFAULT 10 NOT NULL,
	`allocation_enforcement` text DEFAULT 'hard' NOT NULL,
	`balance_refresh_interval_min` integer DEFAULT 5 NOT NULL,
	`balance_cache_usd` real,
	`balance_cached_at` text,
	`mock_scenario_kind` text,
	`mock_execution_tier` text,
	`secret_ref` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `broker_routing` (
	`instrument_class` text PRIMARY KEY NOT NULL,
	`default_broker_account_id` text NOT NULL,
	FOREIGN KEY (`default_broker_account_id`) REFERENCES `broker_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
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
CREATE INDEX `idx_calendar_events_scheduled` ON `calendar_events` (`scheduled_at`);--> statement-breakpoint
CREATE INDEX `idx_calendar_events_symbol_scheduled` ON `calendar_events` (`symbol`,`scheduled_at`);--> statement-breakpoint
CREATE TABLE `capital_reservations` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`approval_id` text,
	`trade_id` text,
	`amount_usd` real NOT NULL,
	`reason` text NOT NULL,
	`status` text DEFAULT 'reserved' NOT NULL,
	`created_at` text NOT NULL,
	`released_at` text,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`approval_id`) REFERENCES `trade_approvals`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`trade_id`) REFERENCES `trades`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_capital_reservations_session` ON `capital_reservations` (`session_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_capital_reservations_approval` ON `capital_reservations` (`approval_id`);--> statement-breakpoint
CREATE TABLE `cik_ticker_cache` (
	`cik` text PRIMARY KEY NOT NULL,
	`ticker` text,
	`looked_up_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `config_presets` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`doc` text NOT NULL,
	`builtin` integer DEFAULT false NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `control_conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`scope_kind` text DEFAULT 'workspace' NOT NULL,
	`scope_session_id` text,
	`auto_approved_json` text DEFAULT '[]' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`scope_session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_control_conversations_updated` ON `control_conversations` (`updated_at`);--> statement-breakpoint
CREATE TABLE `control_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`status` text DEFAULT 'complete' NOT NULL,
	`turn_id` text NOT NULL,
	`input_tokens` integer,
	`output_tokens` integer,
	`cost_usd` real,
	`created_at` text NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `control_conversations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_control_messages_conversation` ON `control_messages` (`conversation_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `control_tool_calls` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`turn_id` text NOT NULL,
	`capability` text NOT NULL,
	`kind` text NOT NULL,
	`input_json` text NOT NULL,
	`result_json` text,
	`status` text DEFAULT 'running' NOT NULL,
	`confirmation` text,
	`affected_entity` text,
	`started_at` text NOT NULL,
	`finished_at` text,
	FOREIGN KEY (`conversation_id`) REFERENCES `control_conversations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_control_tool_calls_conversation` ON `control_tool_calls` (`conversation_id`);--> statement-breakpoint
CREATE INDEX `idx_control_tool_calls_affected` ON `control_tool_calls` (`affected_entity`);--> statement-breakpoint
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
CREATE UNIQUE INDEX `idx_cross_venue_pair` ON `cross_venue_market_links` (`polymarket_id`,`kalshi_ticker`);--> statement-breakpoint
CREATE INDEX `idx_cross_venue_approved` ON `cross_venue_market_links` (`approved`);--> statement-breakpoint
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
CREATE UNIQUE INDEX `idx_data_coverage_symbol_tf` ON `data_coverage` (`symbol`,`timeframe`);--> statement-breakpoint
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
CREATE INDEX `idx_decision_traces_trade` ON `decision_traces` (`trade_id`);--> statement-breakpoint
CREATE TABLE `developer_settings` (
	`id` text PRIMARY KEY DEFAULT 'singleton' NOT NULL,
	`default_event_min_level` text DEFAULT 'INFO' NOT NULL,
	`default_time_window_minutes` integer DEFAULT 60 NOT NULL,
	`default_source_filters_json` text DEFAULT '[]' NOT NULL,
	`include_prompts_in_exports` integer DEFAULT false NOT NULL,
	`include_tool_payloads_in_exports` integer DEFAULT true NOT NULL
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
CREATE INDEX `idx_equity_snapshots_ts` ON `equity_snapshots` (`ts`);--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text,
	`trade_id` text,
	`cycle_id` text,
	`level` text NOT NULL,
	`agent_type` text,
	`message` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`trade_id`) REFERENCES `trades`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_events_session_id` ON `events` (`session_id`);--> statement-breakpoint
CREATE INDEX `idx_events_cycle_id` ON `events` (`cycle_id`);--> statement-breakpoint
CREATE INDEX `idx_events_created_at` ON `events` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_events_session_created` ON `events` (`session_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `experience_experiments` (
	`id` text PRIMARY KEY NOT NULL,
	`experience_id` text NOT NULL,
	`config_hash` text NOT NULL,
	`dataset_window_start` text,
	`dataset_window_end` text,
	`metrics_json` text DEFAULT '{}' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`verdict` text DEFAULT 'inconclusive' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_experience_experiments_experience` ON `experience_experiments` (`experience_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `experience_input_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`template_id` text NOT NULL,
	`template_version` integer NOT NULL,
	`mode` text NOT NULL,
	`name` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`payload_json` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_experience_input_profiles_template` ON `experience_input_profiles` (`template_id`,`template_version`);--> statement-breakpoint
CREATE TABLE `experience_template_revisions` (
	`template_id` text NOT NULL,
	`version` integer NOT NULL,
	`status` text NOT NULL,
	`display_name` text NOT NULL,
	`description` text NOT NULL,
	`pipeline_id` text NOT NULL,
	`strategy_id` text,
	`prompt_variant_key` text NOT NULL,
	`broker_requirement` text NOT NULL,
	`input_contract_json` text NOT NULL,
	`default_preset_ids_json` text NOT NULL,
	`research_contract_json` text NOT NULL,
	`universe_policy` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`template_id`, `version`),
	FOREIGN KEY (`template_id`) REFERENCES `experience_templates`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_experience_template_revisions_status` ON `experience_template_revisions` (`template_id`,`status`);--> statement-breakpoint
CREATE TABLE `experience_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
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
CREATE UNIQUE INDEX `idx_form4_accession_insider` ON `form4_transactions` (`accession_number`,`insider_name`,`transaction_code`,`transaction_date`);--> statement-breakpoint
CREATE INDEX `idx_form4_ticker_filed` ON `form4_transactions` (`ticker`,`filed_at`);--> statement-breakpoint
CREATE TABLE `funding_rates` (
	`id` text PRIMARY KEY NOT NULL,
	`venue` text NOT NULL,
	`symbol` text NOT NULL,
	`ts` text NOT NULL,
	`rate` real NOT NULL,
	`ingested_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_funding_rates_venue_symbol_ts` ON `funding_rates` (`venue`,`symbol`,`ts`);--> statement-breakpoint
CREATE INDEX `idx_funding_rates_symbol_ts` ON `funding_rates` (`symbol`,`ts`);--> statement-breakpoint
CREATE TABLE `instrument_set_members` (
	`set_id` text NOT NULL,
	`set_revision` integer NOT NULL,
	`canonical_id` text NOT NULL,
	`display_symbol` text NOT NULL,
	`venue` text,
	PRIMARY KEY(`set_id`, `set_revision`, `canonical_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_instrument_set_members_set_rev` ON `instrument_set_members` (`set_id`,`set_revision`);--> statement-breakpoint
CREATE TABLE `instrument_set_revisions` (
	`set_id` text NOT NULL,
	`revision` integer NOT NULL,
	`status` text NOT NULL,
	`name` text NOT NULL,
	`instrument_class` text NOT NULL,
	`mode` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`set_id`, `revision`),
	FOREIGN KEY (`set_id`) REFERENCES `instrument_sets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_instrument_set_revisions_status` ON `instrument_set_revisions` (`set_id`,`status`);--> statement-breakpoint
CREATE TABLE `instrument_sets` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `migration_quarantine` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`session_id` text,
	`source_id` text,
	`reason` text NOT NULL,
	`detail_json` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `model_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`experience_id` text NOT NULL,
	`model_kind` text NOT NULL,
	`feature_schema_json` text NOT NULL,
	`training_window_start` text NOT NULL,
	`training_window_end` text NOT NULL,
	`calibration_json` text DEFAULT '{}' NOT NULL,
	`artifact_uri` text,
	`checksum` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_model_versions_experience` ON `model_versions` (`experience_id`,`created_at`);--> statement-breakpoint
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
CREATE UNIQUE INDEX `idx_ohlcv_bars_symbol_tf_ts` ON `ohlcv_bars` (`symbol`,`timeframe`,`ts`);--> statement-breakpoint
CREATE INDEX `idx_ohlcv_bars_symbol_tf` ON `ohlcv_bars` (`symbol`,`timeframe`);--> statement-breakpoint
CREATE TABLE `paper_balances` (
	`account_id` text PRIMARY KEY NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`balance` real NOT NULL,
	`starting_balance` real NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `broker_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
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
CREATE INDEX `idx_paper_positions_account_open` ON `paper_positions` (`account_id`,`open`);--> statement-breakpoint
CREATE TABLE `promotion_decisions` (
	`id` text PRIMARY KEY NOT NULL,
	`experience_id` text NOT NULL,
	`model_version_id` text,
	`from_tier` text NOT NULL,
	`to_tier` text NOT NULL,
	`decision` text NOT NULL,
	`evidence_json` text NOT NULL,
	`decided_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_promotion_decisions_experience` ON `promotion_decisions` (`experience_id`,`decided_at`);--> statement-breakpoint
CREATE TABLE `provider_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`provider_type` text NOT NULL,
	`secret_ref` text NOT NULL,
	`metadata_json` text,
	`is_configured` integer DEFAULT false NOT NULL,
	`last_test_status` text DEFAULT 'unknown' NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `research_summaries` (
	`id` text PRIMARY KEY NOT NULL,
	`period` text NOT NULL,
	`summary_json` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_research_summaries_period` ON `research_summaries` (`period`,`created_at`);--> statement-breakpoint
CREATE TABLE `runtime_log_overrides` (
	`id` text PRIMARY KEY NOT NULL,
	`scope_type` text NOT NULL,
	`scope_id` text,
	`main_log_level` text NOT NULL,
	`event_min_level` text NOT NULL,
	`expires_at` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `schedule_runtime_states` (
	`group_key` text PRIMARY KEY NOT NULL,
	`next_run_at` text,
	`last_started_at` text,
	`last_finished_at` text,
	`last_success_at` text,
	`last_duration_ms` integer,
	`consecutive_failures` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`last_scan_summary_json` text DEFAULT '{}' NOT NULL,
	`subscription_ids_json` text DEFAULT '[]' NOT NULL,
	`instrument_count` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `session_activity` (
	`session_id` text PRIMARY KEY NOT NULL,
	`activity` text NOT NULL,
	`conditions_json` text DEFAULT '[]' NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `session_activity_transitions` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`activity` text NOT NULL,
	`conditions_json` text DEFAULT '[]' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_session_activity_transitions_session` ON `session_activity_transitions` (`session_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `session_broker_assignments` (
	`session_id` text NOT NULL,
	`broker_account_id` text NOT NULL,
	`allocated_usd` real DEFAULT 0 NOT NULL,
	PRIMARY KEY(`session_id`, `broker_account_id`),
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`broker_account_id`) REFERENCES `broker_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `session_broker_routing_overrides` (
	`session_id` text NOT NULL,
	`instrument_class` text NOT NULL,
	`broker_account_id` text NOT NULL,
	PRIMARY KEY(`session_id`, `instrument_class`),
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`broker_account_id`) REFERENCES `broker_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_session_broker_override` ON `session_broker_routing_overrides` (`session_id`,`instrument_class`);--> statement-breakpoint
CREATE TABLE `session_execution_steps` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`cycle_id` text NOT NULL,
	`stage` text NOT NULL,
	`status` text NOT NULL,
	`attempt` integer DEFAULT 0 NOT NULL,
	`started_at` text,
	`completed_at` text,
	`next_retry_at` text,
	`last_error_code` text,
	`last_error_message` text,
	`outcome` text,
	`retryable` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_ses_steps_session_cycle` ON `session_execution_steps` (`session_id`,`cycle_id`);--> statement-breakpoint
CREATE INDEX `idx_ses_steps_session_status` ON `session_execution_steps` (`session_id`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `ux_ses_steps_session_cycle_stage` ON `session_execution_steps` (`session_id`,`cycle_id`,`stage`);--> statement-breakpoint
CREATE TABLE `session_input_subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`template_id` text NOT NULL,
	`template_version` integer NOT NULL,
	`mode` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_from_profile_id` text,
	`revision` integer DEFAULT 1 NOT NULL,
	`source_definition_id` text,
	`source_revision` integer,
	`instrument_set_id` text,
	`instrument_set_revision` integer,
	`cadence_json` text,
	`analysis_timeframe` text NOT NULL,
	`market_calendar_id` text,
	`strategy_parameters_json` text,
	`filters_json` text,
	`uses_unvalidated_universe` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_session_input_subscriptions_session` ON `session_input_subscriptions` (`session_id`);--> statement-breakpoint
CREATE INDEX `idx_session_input_subscriptions_source` ON `session_input_subscriptions` (`source_definition_id`,`enabled`);--> statement-breakpoint
CREATE INDEX `idx_session_input_subscriptions_set` ON `session_input_subscriptions` (`instrument_set_id`,`enabled`);--> statement-breakpoint
CREATE TABLE `session_instrument_cache` (
	`session_id` text PRIMARY KEY NOT NULL,
	`instruments` text NOT NULL,
	`definition_hash` text NOT NULL,
	`selected_at` text NOT NULL,
	`selector_agent_run_id` text,
	`cycle_id` text DEFAULT '' NOT NULL,
	`research_briefs_json` text,
	`research_generated_at` text,
	`expires_at` text,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`selector_agent_run_id`) REFERENCES `agent_runs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `session_signal_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`signal_event_id` text NOT NULL,
	`source_id` text,
	`queue_position_at_enqueue` integer NOT NULL,
	`status` text NOT NULL,
	`status_bucket` text NOT NULL,
	`enqueued_at` text NOT NULL,
	`started_at` text,
	`finished_at` text,
	`expires_at` text,
	`trade_id` text,
	`drop_reason` text,
	`notes_json` text,
	`subscription_id` text,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`signal_event_id`) REFERENCES `signal_events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_ssd_session` ON `session_signal_deliveries` (`session_id`);--> statement-breakpoint
CREATE INDEX `idx_ssd_status` ON `session_signal_deliveries` (`session_id`,`status_bucket`);--> statement-breakpoint
CREATE INDEX `idx_ssd_subscription` ON `session_signal_deliveries` (`subscription_id`);--> statement-breakpoint
CREATE TABLE `session_strategy_config_history` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`version` integer NOT NULL,
	`doc` text NOT NULL,
	`saved_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `session_strategy_configs` (
	`session_id` text PRIMARY KEY NOT NULL,
	`version` integer NOT NULL,
	`schema_version` integer NOT NULL,
	`doc` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `session_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`source_session_id` text,
	`template_payload_json` text NOT NULL,
	`instrument_classes` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_templates_name_unique` ON `session_templates` (`name`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`objective` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`is_focused` integer DEFAULT false NOT NULL,
	`selection_mode` text DEFAULT 'manual_shortlist' NOT NULL,
	`instrument_classes` text NOT NULL,
	`instrument_scope` text NOT NULL,
	`default_search_provider_id` text,
	`execution_mode` text DEFAULT 'paper_only' NOT NULL,
	`experience_id` text DEFAULT 'edgar-catalyst' NOT NULL,
	`strategy_config_json` text,
	`overrides_json` text,
	`live_readiness_acknowledged_at` text,
	`session_input_revision` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`default_search_provider_id`) REFERENCES `provider_accounts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_sessions_status` ON `sessions` (`status`);--> statement-breakpoint
CREATE INDEX `idx_sessions_is_focused` ON `sessions` (`is_focused`);--> statement-breakpoint
CREATE TABLE `signal_dead_letters` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`signal_event_id` text NOT NULL,
	`source_id` text NOT NULL,
	`source_type` text NOT NULL,
	`ticker` text NOT NULL,
	`instrument_class` text,
	`reason` text NOT NULL,
	`detail_json` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	`replayed_at` text,
	`resolved_delivery_id` text,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`signal_event_id`) REFERENCES `signal_events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_signal_dead_letters_session` ON `signal_dead_letters` (`session_id`);--> statement-breakpoint
CREATE INDEX `idx_signal_dead_letters_signal_event` ON `signal_dead_letters` (`signal_event_id`);--> statement-breakpoint
CREATE TABLE `signal_events` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text,
	`source_type` text NOT NULL,
	`ticker` text NOT NULL,
	`company_name` text,
	`document_url` text,
	`accession_number` text,
	`payload_json` text DEFAULT '{}' NOT NULL,
	`filed_at` text NOT NULL,
	`detected_at` text NOT NULL,
	`dispatch_status` text NOT NULL,
	`dispatch_completed_at` text,
	`source_dropped_reason` text,
	`kind` text NOT NULL,
	`dedupe_key` text NOT NULL,
	`ttl` text NOT NULL,
	`occurred_at` text NOT NULL,
	`origin_kind` text,
	`origin_id` text,
	`schedule_group_key` text
);
--> statement-breakpoint
CREATE INDEX `idx_signal_events_source` ON `signal_events` (`source_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_signal_events_accession` ON `signal_events` (`source_id`,`accession_number`) WHERE "signal_events"."accession_number" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_signal_events_dedupe` ON `signal_events` (`source_id`,`dedupe_key`);--> statement-breakpoint
CREATE INDEX `idx_signal_events_origin` ON `signal_events` (`origin_kind`,`origin_id`);--> statement-breakpoint
CREATE TABLE `signal_labels` (
	`observation_id` text NOT NULL,
	`horizon` text NOT NULL,
	`benchmark` text NOT NULL,
	`gross_return_bps` real,
	`cost_bps` real,
	`net_return_bps` real,
	`benchmark_return_bps` real,
	`max_favorable_bps` real,
	`max_adverse_bps` real,
	`outcome_win` integer,
	`label_ready_at` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`observation_id`, `horizon`, `benchmark`),
	FOREIGN KEY (`observation_id`) REFERENCES `signal_observations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `signal_observations` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text,
	`experience_id` text NOT NULL,
	`signal_id` text NOT NULL,
	`cycle_id` text,
	`instrument_symbol` text NOT NULL,
	`instrument_class` text NOT NULL,
	`action` text NOT NULL,
	`event_time` text NOT NULL,
	`observed_at` text NOT NULL,
	`source_uri` text,
	`feature_json` text DEFAULT '{}' NOT NULL,
	`decision_json` text,
	`model_version` text,
	`label_horizon` text NOT NULL,
	`label_benchmark` text NOT NULL,
	`reference_price` real,
	`label_ready_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_signal_observations_experience` ON `signal_observations` (`experience_id`,`event_time`);--> statement-breakpoint
CREATE INDEX `idx_signal_observations_session` ON `signal_observations` (`session_id`);--> statement-breakpoint
CREATE INDEX `idx_signal_observations_label_ready` ON `signal_observations` (`label_ready_at`);--> statement-breakpoint
CREATE TABLE `signal_source_polls` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`polled_at` text NOT NULL,
	`outcome` text NOT NULL,
	`http_status` integer,
	`detected` integer DEFAULT 0 NOT NULL,
	`passed` integer DEFAULT 0 NOT NULL,
	`dropped` integer DEFAULT 0 NOT NULL,
	`drop_reasons_json` text,
	`errors_json` text DEFAULT '[]' NOT NULL,
	`duration_ms` integer DEFAULT 0 NOT NULL,
	`status` text NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `signal_sources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_signal_source_polls_source_polled` ON `signal_source_polls` (`source_id`,`polled_at`);--> statement-breakpoint
CREATE TABLE `signal_source_runtime_states` (
	`source_id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`last_poll_at` text,
	`last_success_at` text,
	`consecutive_failures` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`last_outcome` text,
	`http_status` integer,
	`detected` integer DEFAULT 0 NOT NULL,
	`passed` integer DEFAULT 0 NOT NULL,
	`dropped` integer DEFAULT 0 NOT NULL,
	`errors_json` text DEFAULT '[]' NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `signal_sources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `signal_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`enabled` integer DEFAULT true NOT NULL,
	`config_json` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `source_definition_revisions` (
	`source_definition_id` text NOT NULL,
	`revision` integer NOT NULL,
	`config_json` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`source_definition_id`, `revision`),
	FOREIGN KEY (`source_definition_id`) REFERENCES `source_definitions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `source_definitions` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`enabled` integer DEFAULT true NOT NULL,
	`integration_id` text,
	`output_contract_id` text NOT NULL,
	`config_schema_version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `trade_approvals` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`trade_id` text NOT NULL,
	`broker_account_id` text NOT NULL,
	`instrument_symbol` text NOT NULL,
	`instrument_display_name` text,
	`prediction_outcome` text,
	`instrument_metadata_json` text,
	`instrument_class` text NOT NULL,
	`proposed_side` text NOT NULL,
	`proposed_size_usd` real NOT NULL,
	`decision_summary_json` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`requested_at` text NOT NULL,
	`resolved_at` text,
	`decision_note` text,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`trade_id`) REFERENCES `trades`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_approvals_session` ON `trade_approvals` (`session_id`,`status`);--> statement-breakpoint
CREATE TABLE `trades` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`broker_account_id` text,
	`instrument_symbol` text NOT NULL,
	`instrument_display_name` text,
	`prediction_outcome` text,
	`instrument_metadata_json` text,
	`instrument_type` text DEFAULT 'stock' NOT NULL,
	`side` text NOT NULL,
	`entry_price` real,
	`position_size_usd` real NOT NULL,
	`stop_loss_price` real,
	`take_profit_price` real,
	`strategy` text NOT NULL,
	`execution_strategy` text,
	`status` text NOT NULL,
	`opened_at` text,
	`closed_at` text,
	`final_pnl_usd` real,
	`ai_cost_usd` real DEFAULT 0 NOT NULL,
	`confidence_score` real,
	`broker_order_id` text,
	`high_water_mark_price` real,
	`low_water_mark_price` real,
	`exit_reason` text,
	`closure_source` text,
	`client_order_id` text,
	`close_market_snapshot_json` text,
	`mfe_usd` real,
	`mae_usd` real,
	`spread_at_entry_bps` real,
	`slippage_bps` real,
	`commission_usd` real,
	`borrow_cost_usd` real,
	`execution_cost_usd` real,
	`take_profit_touched_at` text,
	`stop_touched_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`broker_account_id`) REFERENCES `broker_accounts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_trades_session_id` ON `trades` (`session_id`);--> statement-breakpoint
CREATE INDEX `idx_trades_status` ON `trades` (`status`);--> statement-breakpoint
CREATE INDEX `idx_trades_instrument` ON `trades` (`instrument_symbol`,`broker_account_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_trades_opened_at` ON `trades` (`opened_at`);--> statement-breakpoint
CREATE INDEX `idx_trades_closed_at` ON `trades` (`closed_at`);--> statement-breakpoint
CREATE INDEX `idx_trades_status_opened` ON `trades` (`status`,`opened_at`);--> statement-breakpoint
CREATE TABLE `workspace_preferences` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`global_include_archived` integer DEFAULT false NOT NULL,
	`global_environment_mode` text DEFAULT 'paper' NOT NULL,
	`default_search_provider_id` text,
	`allocation_enforcement_override` text,
	`default_model_provider_key` text DEFAULT '' NOT NULL,
	`default_model_model_id` text DEFAULT '' NOT NULL,
	`default_model_reasoning_level` text DEFAULT 'off' NOT NULL,
	`auto_approve_assistant_tools` integer DEFAULT false NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`default_search_provider_id`) REFERENCES `provider_accounts`(`id`) ON UPDATE no action ON DELETE set null
);
