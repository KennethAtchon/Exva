import { integer, primaryKey, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const providerAccounts = sqliteTable("provider_accounts", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  category: text("category").notNull(),
  providerType: text("provider_type").notNull(),
  secretRef: text("secret_ref").notNull(),
  metadataJson: text("metadata_json"),
  isConfigured: integer("is_configured", { mode: "boolean" }).notNull().default(false),
  lastTestStatus: text("last_test_status").notNull().default("unknown"),
  updatedAt: text("updated_at").notNull(),
});

export const brokerAccounts = sqliteTable("broker_accounts", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  brokerType: text("broker_type").notNull(),
  supportedInstrumentClasses: text("supported_instrument_classes").notNull(),
  mode: text("mode").notNull().default("paper"),
  secretRef: text("secret_ref").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  objective: text("objective").notNull(),
  status: text("status").notNull().default("draft"),
  isFocused: integer("is_focused", { mode: "boolean" }).notNull().default(false),
  selectionMode: text("selection_mode").notNull().default("manual_shortlist"),
  instrumentClasses: text("instrument_classes").notNull(),
  instrumentScope: text("instrument_scope").notNull(),
  defaultSearchProviderId: text("default_search_provider_id").references(() => providerAccounts.id, {
    onDelete: "set null",
  }),
  capitalLimitUsd: real("capital_limit_usd").notNull(),
  executionMode: text("execution_mode").notNull().default("paper_only"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const sessionSelectorSettings = sqliteTable("session_selector_settings", {
  sessionId: text("session_id")
    .primaryKey()
    .references(() => sessions.id, { onDelete: "cascade" }),
  aiPickerEnabled: integer("ai_picker_enabled", { mode: "boolean" }).notNull().default(true),
  updatedAt: text("updated_at").notNull(),
});

export const sessionStrategies = sqliteTable("session_strategies", {
  sessionId: text("session_id")
    .primaryKey()
    .references(() => sessions.id, { onDelete: "cascade" }),
  strategyProfile: text("strategy_profile").notNull().default("passive_income"),
  maxPositionUsd: real("max_position_usd").notNull().default(500),
  stopLossPct: real("stop_loss_pct").notNull().default(2),
  takeProfitPct: real("take_profit_pct").notNull().default(4),
  maxConcurrentTrades: integer("max_concurrent_trades").notNull().default(3),
  researchDepth: text("research_depth").notNull().default("balanced"),
  dailyLossLimitUsd: real("daily_loss_limit_usd").notNull().default(200),
  profitTargetUsd: real("profit_target_usd").notNull().default(1000),
  maxAiSpendUsd: real("max_ai_spend_usd").notNull().default(5),
  humanApprovalRequired: integer("human_approval_required", { mode: "boolean" }).notNull().default(false),
  primaryTradingTimeframe: text("primary_trading_timeframe").notNull().default("1d"),
  holdingStyle: text("holding_style").notNull().default("multi_day_swing"),
  targetHoldDays: real("target_hold_days"),
  maxHoldDays: real("max_hold_days"),
  timeframeNotes: text("timeframe_notes").notNull().default(""),
});

/** How the session weights discovery vs evidence vs fundamentals (edge / screening posture). */
export const sessionResearchPosture = sqliteTable("session_research_posture", {
  sessionId: text("session_id")
    .primaryKey()
    .references(() => sessions.id, { onDelete: "cascade" }),
  posturePresetId: text("posture_preset_id").notNull().default("custom"),
  discoveryMode: text("discovery_mode").notNull().default("custom"),
  evidenceMode: text("evidence_mode").notNull().default("balanced"),
  catalystMode: text("catalyst_mode").notNull().default("preferred"),
  fundamentalStrictness: text("fundamental_strictness").notNull().default("balanced"),
  postureNotes: text("posture_notes").notNull().default(""),
  updatedAt: text("updated_at").notNull(),
});

/**
 * Per-session, per-role operating instructions stored as one validated JSON document.
 * This reuses the legacy `operating_spec_json` column so no migration-file change is required.
 */
export const sessionAiRoleProfile = sqliteTable(
  "session_ai_role_profile",
  {
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    profileJson: text("operating_spec_json").notNull().default('{"version":1}'),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.sessionId, table.role] }),
  }),
);

export const sessionTradeRules = sqliteTable("session_trade_rules", {
  sessionId: text("session_id")
    .primaryKey()
    .references(() => sessions.id, { onDelete: "cascade" }),
  rulesPresetId: text("rules_preset_id").notNull().default("custom"),
  setupType: text("setup_type").notNull().default("custom"),
  sideBias: text("side_bias").notNull().default("both"),
  entryStyle: text("entry_style").notNull().default("breakout"),
  exitStyle: text("exit_style").notNull().default("fixed_pct"),
  scalingMode: text("scaling_mode").notNull().default("single_entry"),
  tradeRulesMarkdown: text("trade_rules_markdown").notNull().default(""),
  ruleNotes: text("rule_notes").notNull().default(""),
  updatedAt: text("updated_at").notNull(),
});

export const sessionRiskConfig = sqliteTable("session_risk_config", {
  sessionId: text("session_id")
    .primaryKey()
    .references(() => sessions.id, { onDelete: "cascade" }),
  maxPositionUsd: real("max_position_usd").notNull().default(500),
  stopLossPct: real("stop_loss_pct"),
  takeProfitPct: real("take_profit_pct"),
  stopLossType: text("stop_loss_type").notNull().default("fixed_pct"),
  atrStopMultiplier: real("atr_stop_multiplier"),
  kellyFraction: real("kelly_fraction").notNull().default(0.25),
  predictionEdgeThreshold: real("prediction_edge_threshold").notNull().default(0.08),
  maxExposureUsd: real("max_exposure_usd"),
  waitForOpenThreshold: real("wait_for_open_threshold").notNull().default(0.8),
  maxConcurrentTrades: integer("max_concurrent_trades").notNull().default(3),
  dailyLossLimitUsd: real("daily_loss_limit_usd").notNull().default(200),
  profitTargetUsd: real("profit_target_usd").notNull().default(1000),
  maxAiSpendUsd: real("max_ai_spend_usd").notNull().default(5),
  maxDataSpendUsd: real("max_data_spend_usd").notNull().default(5),
  humanApprovalRequired: integer("human_approval_required", { mode: "boolean" }).notNull().default(false),
  updatedAt: text("updated_at").notNull(),
});

export const sessionTimeframeConfig = sqliteTable("session_timeframe_config", {
  sessionId: text("session_id")
    .primaryKey()
    .references(() => sessions.id, { onDelete: "cascade" }),
  primaryTradingTimeframe: text("primary_trading_timeframe").notNull().default("1d"),
  holdingStyle: text("holding_style").notNull().default("multi_day_swing"),
  targetHoldDays: real("target_hold_days"),
  maxHoldDays: real("max_hold_days"),
  timeframeNotes: text("timeframe_notes").notNull().default(""),
  updatedAt: text("updated_at").notNull(),
});

export const sessionAiRoles = sqliteTable("session_ai_roles", {
  id: text("id").primaryKey(),
  sessionId: text("session_id")
    .notNull()
    .references(() => sessions.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  providerKey: text("provider_key").notNull(),
  modelId: text("model_id").notNull(),
  temperature: real("temperature").notNull().default(0.7),
  maxTokens: integer("max_tokens").notNull().default(8192),
  promptSource: text("prompt_source").notNull().default("default"),
  promptMarkdown: text("prompt_markdown").notNull().default(""),
  promptAssetPath: text("prompt_asset_path"),
});

export const brokerRoutingDefaults = sqliteTable("broker_routing", {
  instrumentClass: text("instrument_class").primaryKey(),
  defaultBrokerAccountId: text("default_broker_account_id")
    .notNull()
    .references(() => brokerAccounts.id, { onDelete: "cascade" }),
});

export const sessionBrokerRoutingOverrides = sqliteTable(
  "session_broker_routing_overrides",
  {
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    instrumentClass: text("instrument_class").notNull(),
    brokerAccountId: text("broker_account_id")
      .notNull()
      .references(() => brokerAccounts.id, { onDelete: "cascade" }),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.sessionId, table.instrumentClass] }),
  }),
);

export const sessionBrokerAssignments = sqliteTable(
  "session_broker_assignments",
  {
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    brokerAccountId: text("broker_account_id")
      .notNull()
      .references(() => brokerAccounts.id, { onDelete: "cascade" }),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.sessionId, table.brokerAccountId] }),
  }),
);

export const workspacePreferences = sqliteTable("workspace_preferences", {
  id: integer("id").primaryKey().default(1),
  globalIncludeArchived: integer("global_include_archived", { mode: "boolean" }).notNull().default(false),
  defaultSearchProviderId: text("default_search_provider_id").references(() => providerAccounts.id, {
    onDelete: "set null",
  }),
  capitalAllocationMode: text("capital_allocation_mode").notNull().default("per_session_only"),
  globalCapitalPoolUsd: real("global_capital_pool_usd"),
  updatedAt: text("updated_at").notNull(),
});

export const sessionTemplates = sqliteTable("session_templates", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  description: text("description"),
  sourceSessionId: text("source_session_id"),
  templatePayloadJson: text("template_payload_json").notNull(),
  instrumentClasses: text("instrument_classes").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const trades = sqliteTable("trades", {
  id: text("id").primaryKey(),
  sessionId: text("session_id")
    .notNull()
    .references(() => sessions.id, { onDelete: "cascade" }),
  brokerAccountId: text("broker_account_id").references(() => brokerAccounts.id, { onDelete: "set null" }),
  instrumentSymbol: text("instrument_symbol").notNull(),
  instrumentDisplayName: text("instrument_display_name"),
  predictionOutcome: text("prediction_outcome"),
  instrumentMetadataJson: text("instrument_metadata_json"),
  instrumentType: text("instrument_type").notNull().default("stock"),
  side: text("side").notNull(),
  entryPrice: real("entry_price"),
  positionSizeUsd: real("position_size_usd").notNull(),
  stopLossPrice: real("stop_loss_price"),
  takeProfitPrice: real("take_profit_price"),
  strategy: text("strategy").notNull(),
  status: text("status").notNull(),
  openedAt: text("opened_at"),
  closedAt: text("closed_at"),
  finalPnlUsd: real("final_pnl_usd"),
  aiCostUsd: real("ai_cost_usd").notNull().default(0),
  confidenceScore: real("confidence_score"),
  brokerOrderId: text("broker_order_id"),
  createdAt: text("created_at").notNull(),
});

export const agentRuns = sqliteTable("agent_runs", {
  id: text("id").primaryKey(),
  sessionId: text("session_id")
    .notNull()
    .references(() => sessions.id, { onDelete: "cascade" }),
  tradeId: text("trade_id").references(() => trades.id, { onDelete: "cascade" }),
  agentType: text("agent_type").notNull(),
  model: text("model").notNull(),
  providerKey: text("provider_key").notNull().default("unknown"),
  finishReason: text("finish_reason").notNull().default("stop"),
  inputTokens: integer("input_tokens").notNull(),
  outputTokens: integer("output_tokens").notNull(),
  costUsd: real("cost_usd").notNull(),
  outputText: text("output_text").notNull(),
  durationMs: integer("duration_ms").notNull(),
  createdAt: text("created_at").notNull(),
});

export const agentMessages = sqliteTable("agent_messages", {
  id: text("id").primaryKey(),
  agentRunId: text("agent_run_id")
    .notNull()
    .references(() => agentRuns.id, { onDelete: "cascade" }),
  sessionId: text("session_id")
    .notNull()
    .references(() => sessions.id, { onDelete: "cascade" }),
  tradeId: text("trade_id").references(() => trades.id, { onDelete: "cascade" }),
  cycleId: text("cycle_id"),
  role: text("role").notNull(),
  providerKey: text("provider_key").notNull(),
  modelId: text("model_id").notNull(),
  messagesJson: text("messages_json").notNull(),
  thinkingJson: text("thinking_json"),
  toolCallsJson: text("tool_calls_json"),
  outputJson: text("output_json"),
  outputSchemaName: text("output_schema_name"),
  parseFallback: integer("parse_fallback").notNull().default(0),
  strategySnapshotJson: text("strategy_snapshot_json").notNull(),
  marketSnapshotJson: text("market_snapshot_json"),
  createdAt: text("created_at").notNull(),
});

export const sessionInstrumentCache = sqliteTable("session_instrument_cache", {
  sessionId: text("session_id")
    .primaryKey()
    .references(() => sessions.id, { onDelete: "cascade" }),
  instruments: text("instruments").notNull(),
  definitionHash: text("definition_hash").notNull(),
  selectedAt: text("selected_at").notNull(),
  selectorAgentRunId: text("selector_agent_run_id").references(() => agentRuns.id, { onDelete: "set null" }),
  cycleId: text("cycle_id").notNull().default(""),
  researchBriefsJson: text("research_briefs_json"),
  researchGeneratedAt: text("research_generated_at"),
});

export const apiCallLog = sqliteTable("api_call_log", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").references(() => sessions.id, { onDelete: "cascade" }),
  tradeId: text("trade_id").references(() => trades.id, { onDelete: "cascade" }),
  cycleId: text("cycle_id"),
  provider: text("provider").notNull(),
  endpoint: text("endpoint").notNull(),
  callType: text("call_type").notNull(),
  creditsUsed: integer("credits_used"),
  costUsd: real("cost_usd"),
  latencyMs: integer("latency_ms").notNull(),
  status: text("status").notNull(),
  fromCache: integer("from_cache", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull(),
});

export const tradeAutopsies = sqliteTable("trade_autopsies", {
  id: text("id").primaryKey(),
  tradeId: text("trade_id")
    .notNull()
    .references(() => trades.id, { onDelete: "cascade" }),
  sessionId: text("session_id")
    .notNull()
    .references(() => sessions.id, { onDelete: "cascade" }),
  modelId: text("model_id").notNull(),
  summary: text("summary").notNull(),
  createdAt: text("created_at").notNull(),
  createdBy: text("created_by").notNull().default("user"),
});

export const events = sqliteTable("events", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").references(() => sessions.id, { onDelete: "set null" }),
  tradeId: text("trade_id").references(() => trades.id, { onDelete: "set null" }),
  cycleId: text("cycle_id"),
  level: text("level").notNull(),
  agentType: text("agent_type"),
  message: text("message").notNull(),
  createdAt: text("created_at").notNull(),
});

export const tradeApprovals = sqliteTable("trade_approvals", {
  id: text("id").primaryKey(),
  sessionId: text("session_id")
    .notNull()
    .references(() => sessions.id, { onDelete: "cascade" }),
  tradeId: text("trade_id")
    .notNull()
    .references(() => trades.id, { onDelete: "cascade" }),
  brokerAccountId: text("broker_account_id").notNull(),
  instrumentSymbol: text("instrument_symbol").notNull(),
  instrumentDisplayName: text("instrument_display_name"),
  predictionOutcome: text("prediction_outcome"),
  instrumentMetadataJson: text("instrument_metadata_json"),
  instrumentClass: text("instrument_class").notNull(),
  proposedSide: text("proposed_side").notNull(),
  proposedSizeUsd: real("proposed_size_usd").notNull(),
  decisionSummaryJson: text("decision_summary_json").notNull(),
  status: text("status").notNull().default("pending"),
  requestedAt: text("requested_at").notNull(),
  resolvedAt: text("resolved_at"),
  decisionNote: text("decision_note"),
});

export const capitalReservations = sqliteTable("capital_reservations", {
  id: text("id").primaryKey(),
  sessionId: text("session_id")
    .notNull()
    .references(() => sessions.id, { onDelete: "cascade" }),
  approvalId: text("approval_id").references(() => tradeApprovals.id, { onDelete: "set null" }),
  tradeId: text("trade_id").references(() => trades.id, { onDelete: "set null" }),
  amountUsd: real("amount_usd").notNull(),
  reason: text("reason").notNull(),
  status: text("status").notNull().default("reserved"),
  createdAt: text("created_at").notNull(),
  releasedAt: text("released_at"),
});
