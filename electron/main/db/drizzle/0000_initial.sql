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
CREATE TABLE `autopsy_lessons` (
	`id` text PRIMARY KEY NOT NULL,
	`autopsy_id` text NOT NULL,
	`trade_id` text NOT NULL,
	`session_id` text NOT NULL,
	`lesson` text NOT NULL,
	`severity` text DEFAULT 'medium' NOT NULL,
	`category` text DEFAULT 'strategy' NOT NULL,
	`proposed_fix` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`recurrence_count` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`validated_at` text,
	FOREIGN KEY (`autopsy_id`) REFERENCES `trade_autopsies`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`trade_id`) REFERENCES `trades`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_autopsy_lessons_autopsy` ON `autopsy_lessons` (`autopsy_id`);--> statement-breakpoint
CREATE INDEX `idx_autopsy_lessons_session` ON `autopsy_lessons` (`session_id`);--> statement-breakpoint
CREATE INDEX `idx_autopsy_lessons_status` ON `autopsy_lessons` (`status`);--> statement-breakpoint
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
CREATE TABLE `developer_settings` (
	`id` text PRIMARY KEY DEFAULT 'singleton' NOT NULL,
	`default_event_min_level` text DEFAULT 'INFO' NOT NULL,
	`default_time_window_minutes` integer DEFAULT 60 NOT NULL,
	`default_source_filters_json` text DEFAULT '[]' NOT NULL,
	`include_prompts_in_exports` integer DEFAULT false NOT NULL,
	`include_tool_payloads_in_exports` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
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
CREATE TABLE `global_presets` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`is_built_in` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`preset_json` text NOT NULL
);
--> statement-breakpoint
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
CREATE TABLE `research_posture_presets` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`is_built_in` integer DEFAULT false NOT NULL,
	`preset_json` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `risk_presets` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`is_built_in` integer DEFAULT false NOT NULL,
	`preset_json` text NOT NULL
);
--> statement-breakpoint
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
CREATE TABLE `session_ai_phase_workers` (
	`session_id` text NOT NULL,
	`phase` text NOT NULL,
	`worker_id` text NOT NULL,
	`provider_key` text,
	`model_id` text,
	`max_steps` integer,
	`spend_limit_usd` real,
	`prompt_markdown` text,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`session_id`, `phase`, `worker_id`),
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `session_ai_phases` (
	`session_id` text NOT NULL,
	`phase` text NOT NULL,
	`provider_key` text DEFAULT '' NOT NULL,
	`model_id` text DEFAULT '' NOT NULL,
	`temperature` real DEFAULT 0.7 NOT NULL,
	`max_tokens` integer DEFAULT 8192 NOT NULL,
	`reasoning_level` text DEFAULT 'off' NOT NULL,
	`prompt_source` text DEFAULT 'default' NOT NULL,
	`prompt_markdown` text DEFAULT '' NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`session_id`, `phase`),
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_session_ai_phases_session` ON `session_ai_phases` (`session_id`);--> statement-breakpoint
CREATE TABLE `session_ai_settings` (
	`session_id` text PRIMARY KEY NOT NULL,
	`worker_guidance_markdown` text DEFAULT '' NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
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
CREATE TABLE `session_research_posture` (
	`session_id` text PRIMARY KEY NOT NULL,
	`posture_preset_id` text DEFAULT 'custom' NOT NULL,
	`discovery_mode` text DEFAULT 'custom' NOT NULL,
	`evidence_mode` text DEFAULT 'balanced' NOT NULL,
	`catalyst_mode` text DEFAULT 'preferred' NOT NULL,
	`fundamental_strictness` text DEFAULT 'balanced' NOT NULL,
	`posture_notes` text DEFAULT '' NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `session_risk_config` (
	`session_id` text PRIMARY KEY NOT NULL,
	`risk_preset_id` text DEFAULT 'custom' NOT NULL,
	`max_position_usd` real DEFAULT 500 NOT NULL,
	`stop_loss_pct` real,
	`take_profit_pct` real,
	`stop_loss_type` text DEFAULT 'fixed_pct' NOT NULL,
	`atr_stop_multiplier` real,
	`kelly_fraction` real DEFAULT 0.25 NOT NULL,
	`prediction_edge_threshold` real DEFAULT 0.08 NOT NULL,
	`max_exposure_usd` real,
	`wait_for_open_threshold` real DEFAULT 0.8 NOT NULL,
	`max_concurrent_trades` integer DEFAULT 3 NOT NULL,
	`daily_loss_limit_usd` real DEFAULT 200 NOT NULL,
	`profit_target_usd` real DEFAULT 1000 NOT NULL,
	`max_ai_spend_usd` real DEFAULT 5 NOT NULL,
	`max_data_spend_usd` real DEFAULT 5 NOT NULL,
	`human_approval_required` integer DEFAULT false NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `session_selector_settings` (
	`session_id` text PRIMARY KEY NOT NULL,
	`ai_picker_enabled` integer DEFAULT true NOT NULL,
	`no_instrument_retry_minutes` integer,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `session_strategies` (
	`session_id` text PRIMARY KEY NOT NULL,
	`strategy_profile` text DEFAULT 'passive_income' NOT NULL,
	`max_position_usd` real DEFAULT 500 NOT NULL,
	`stop_loss_pct` real DEFAULT 2 NOT NULL,
	`take_profit_pct` real DEFAULT 4 NOT NULL,
	`max_concurrent_trades` integer DEFAULT 3 NOT NULL,
	`research_depth` text DEFAULT 'balanced' NOT NULL,
	`daily_loss_limit_usd` real DEFAULT 200 NOT NULL,
	`profit_target_usd` real DEFAULT 1000 NOT NULL,
	`max_ai_spend_usd` real DEFAULT 5 NOT NULL,
	`human_approval_required` integer DEFAULT false NOT NULL,
	`primary_trading_timeframe` text DEFAULT '1d' NOT NULL,
	`holding_style` text DEFAULT 'multi_day_swing' NOT NULL,
	`target_hold_days` real,
	`max_hold_days` real,
	`timeframe_notes` text DEFAULT '' NOT NULL,
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
CREATE TABLE `session_timeframe_config` (
	`session_id` text PRIMARY KEY NOT NULL,
	`timeframe_preset_id` text DEFAULT 'custom' NOT NULL,
	`primary_trading_timeframe` text DEFAULT '1d' NOT NULL,
	`holding_style` text DEFAULT 'multi_day_swing' NOT NULL,
	`target_hold_days` real,
	`max_hold_days` real,
	`timeframe_notes` text DEFAULT '' NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `session_trade_rules` (
	`session_id` text PRIMARY KEY NOT NULL,
	`rules_preset_id` text DEFAULT 'custom' NOT NULL,
	`setup_type` text DEFAULT 'custom' NOT NULL,
	`side_bias` text DEFAULT 'both' NOT NULL,
	`entry_style` text DEFAULT 'breakout' NOT NULL,
	`exit_style` text DEFAULT 'fixed_pct' NOT NULL,
	`scaling_mode` text DEFAULT 'single_entry' NOT NULL,
	`trade_rules_markdown` text DEFAULT '' NOT NULL,
	`rule_notes` text DEFAULT '' NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
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
	`live_readiness_acknowledged_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`default_search_provider_id`) REFERENCES `provider_accounts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_sessions_status` ON `sessions` (`status`);--> statement-breakpoint
CREATE INDEX `idx_sessions_is_focused` ON `sessions` (`is_focused`);--> statement-breakpoint
CREATE TABLE `timeframe_presets` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`is_built_in` integer DEFAULT false NOT NULL,
	`preset_json` text NOT NULL
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
CREATE TABLE `trade_autopsies` (
	`id` text PRIMARY KEY NOT NULL,
	`trade_id` text NOT NULL,
	`session_id` text NOT NULL,
	`model_id` text NOT NULL,
	`summary` text NOT NULL,
	`summary_structured_json` text DEFAULT '{}' NOT NULL,
	`phase_traces_json` text DEFAULT '[]' NOT NULL,
	`quality_grade` text,
	`quality_score` real,
	`is_fallback` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text DEFAULT 'user' NOT NULL,
	FOREIGN KEY (`trade_id`) REFERENCES `trades`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_trade_autopsies_trade` ON `trade_autopsies` (`trade_id`);--> statement-breakpoint
CREATE TABLE `trade_rule_presets` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`is_built_in` integer DEFAULT false NOT NULL,
	`preset_json` text NOT NULL
);
--> statement-breakpoint
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
	`exit_reason` text,
	`client_order_id` text,
	`close_market_snapshot_json` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`broker_account_id`) REFERENCES `broker_accounts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_trades_session_id` ON `trades` (`session_id`);--> statement-breakpoint
CREATE INDEX `idx_trades_status` ON `trades` (`status`);--> statement-breakpoint
CREATE INDEX `idx_trades_instrument` ON `trades` (`instrument_symbol`,`broker_account_id`,`status`);--> statement-breakpoint
CREATE TABLE `workspace_preferences` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`global_include_archived` integer DEFAULT false NOT NULL,
	`global_environment_mode` text DEFAULT 'paper' NOT NULL,
	`default_search_provider_id` text,
	`allocation_enforcement_override` text,
	`default_model_provider_key` text DEFAULT '' NOT NULL,
	`default_model_model_id` text DEFAULT '' NOT NULL,
	`default_model_reasoning_level` text DEFAULT 'off' NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`default_search_provider_id`) REFERENCES `provider_accounts`(`id`) ON UPDATE no action ON DELETE set null
);
