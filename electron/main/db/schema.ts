import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const providerAccounts = sqliteTable("provider_accounts", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  category: text("category").notNull(),
  providerType: text("provider_type").notNull(),
  secretRef: text("secret_ref").notNull(),
  metadataJson: text("metadata_json"),
  isConfigured: integer("is_configured", { mode: "boolean" })
    .notNull()
    .default(false),
  lastTestStatus: text("last_test_status").notNull().default("unknown"),
  updatedAt: text("updated_at").notNull(),
});

export const brokerAccounts = sqliteTable("broker_accounts", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  brokerType: text("broker_type").notNull(),
  supportedInstrumentClasses: text("supported_instrument_classes").notNull(),
  mode: text("mode").notNull().default("paper"),
  maxSessions: integer("max_sessions").notNull().default(10),
  allocationEnforcement: text("allocation_enforcement")
    .notNull()
    .default("hard"),
  balanceRefreshIntervalMin: integer("balance_refresh_interval_min")
    .notNull()
    .default(5),
  balanceCacheUsd: real("balance_cache_usd"),
  balanceCachedAt: text("balance_cached_at"),
  mockScenarioKind: text("mock_scenario_kind"),
  secretRef: text("secret_ref").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    objective: text("objective").notNull(),
    status: text("status").notNull().default("draft"),
    isFocused: integer("is_focused", { mode: "boolean" })
      .notNull()
      .default(false),
    selectionMode: text("selection_mode").notNull().default("manual_shortlist"),
    instrumentClasses: text("instrument_classes").notNull(),
    instrumentScope: text("instrument_scope").notNull(),
    defaultSearchProviderId: text("default_search_provider_id").references(
      () => providerAccounts.id,
      {
        onDelete: "set null",
      },
    ),
    executionMode: text("execution_mode").notNull().default("paper_only"),
    liveReadinessAcknowledgedAt: text("live_readiness_acknowledged_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({
    statusIdx: index("idx_sessions_status").on(table.status),
    isFocusedIdx: index("idx_sessions_is_focused").on(table.isFocused),
  }),
);

export const sessionExecutionSteps = sqliteTable(
  "session_execution_steps",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    cycleId: text("cycle_id").notNull(),
    stage: text("stage").notNull(),
    status: text("status").notNull(),
    attempt: integer("attempt").notNull().default(0),
    startedAt: text("started_at"),
    completedAt: text("completed_at"),
    nextRetryAt: text("next_retry_at"),
    lastErrorCode: text("last_error_code"),
    lastErrorMessage: text("last_error_message"),
    outcome: text("outcome"),
    retryable: integer("retryable", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({
    sessionCycleIdx: index("idx_ses_steps_session_cycle").on(
      table.sessionId,
      table.cycleId,
    ),
    sessionStatusIdx: index("idx_ses_steps_session_status").on(
      table.sessionId,
      table.status,
    ),
    sessionCycleStageKey: uniqueIndex("ux_ses_steps_session_cycle_stage").on(
      table.sessionId,
      table.cycleId,
      table.stage,
    ),
  }),
);

export const sessionSelectorSettings = sqliteTable(
  "session_selector_settings",
  {
    sessionId: text("session_id")
      .primaryKey()
      .references(() => sessions.id, { onDelete: "cascade" }),
    aiPickerEnabled: integer("ai_picker_enabled", { mode: "boolean" })
      .notNull()
      .default(true),
    noInstrumentRetryMinutes: integer("no_instrument_retry_minutes"),
    updatedAt: text("updated_at").notNull(),
  },
);

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
  humanApprovalRequired: integer("human_approval_required", { mode: "boolean" })
    .notNull()
    .default(false),
  primaryTradingTimeframe: text("primary_trading_timeframe")
    .notNull()
    .default("1d"),
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
  fundamentalStrictness: text("fundamental_strictness")
    .notNull()
    .default("balanced"),
  postureNotes: text("posture_notes").notNull().default(""),
  updatedAt: text("updated_at").notNull(),
});

export const sessionAiSettings = sqliteTable("session_ai_settings", {
  sessionId: text("session_id")
    .primaryKey()
    .references(() => sessions.id, { onDelete: "cascade" }),
  workerGuidanceMarkdown: text("worker_guidance_markdown").notNull().default(""),
  updatedAt: text("updated_at").notNull(),
});

export const sessionAiPhases = sqliteTable(
  "session_ai_phases",
  {
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    phase: text("phase").notNull(),
    providerKey: text("provider_key").notNull().default(""),
    modelId: text("model_id").notNull().default(""),
    temperature: real("temperature").notNull().default(0.7),
    maxTokens: integer("max_tokens").notNull().default(8192),
    reasoningLevel: text("reasoning_level").notNull().default("off"),
    promptSource: text("prompt_source").notNull().default("default"),
    promptMarkdown: text("prompt_markdown").notNull().default(""),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.sessionId, table.phase] }),
    sessionIdx: index("idx_session_ai_phases_session").on(table.sessionId),
  }),
);

export const sessionAiPhaseWorkers = sqliteTable(
  "session_ai_phase_workers",
  {
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    phase: text("phase").notNull(),
    workerId: text("worker_id").notNull(),
    providerKey: text("provider_key"),
    modelId: text("model_id"),
    maxSteps: integer("max_steps"),
    spendLimitUsd: real("spend_limit_usd"),
    promptMarkdown: text("prompt_markdown"),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.sessionId, table.phase, table.workerId] }),
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
  riskPresetId: text("risk_preset_id").notNull().default("custom"),
  maxPositionUsd: real("max_position_usd").notNull().default(500),
  stopLossPct: real("stop_loss_pct"),
  takeProfitPct: real("take_profit_pct"),
  stopLossType: text("stop_loss_type").notNull().default("fixed_pct"),
  atrStopMultiplier: real("atr_stop_multiplier"),
  kellyFraction: real("kelly_fraction").notNull().default(0.25),
  predictionEdgeThreshold: real("prediction_edge_threshold")
    .notNull()
    .default(0.08),
  maxExposureUsd: real("max_exposure_usd"),
  waitForOpenThreshold: real("wait_for_open_threshold").notNull().default(0.8),
  maxConcurrentTrades: integer("max_concurrent_trades").notNull().default(3),
  dailyLossLimitUsd: real("daily_loss_limit_usd").notNull().default(200),
  profitTargetUsd: real("profit_target_usd").notNull().default(1000),
  maxAiSpendUsd: real("max_ai_spend_usd").notNull().default(5),
  maxDataSpendUsd: real("max_data_spend_usd").notNull().default(5),
  humanApprovalRequired: integer("human_approval_required", { mode: "boolean" })
    .notNull()
    .default(false),
  updatedAt: text("updated_at").notNull(),
});

export const sessionTimeframeConfig = sqliteTable("session_timeframe_config", {
  sessionId: text("session_id")
    .primaryKey()
    .references(() => sessions.id, { onDelete: "cascade" }),
  timeframePresetId: text("timeframe_preset_id").notNull().default("custom"),
  primaryTradingTimeframe: text("primary_trading_timeframe")
    .notNull()
    .default("1d"),
  holdingStyle: text("holding_style").notNull().default("multi_day_swing"),
  targetHoldDays: real("target_hold_days"),
  maxHoldDays: real("max_hold_days"),
  timeframeNotes: text("timeframe_notes").notNull().default(""),
  updatedAt: text("updated_at").notNull(),
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
    sessionInstrumentClassIdx: index("idx_session_broker_override").on(
      table.sessionId,
      table.instrumentClass,
    ),
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
    allocatedUsd: real("allocated_usd").notNull().default(0),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.sessionId, table.brokerAccountId] }),
  }),
);

export const workspacePreferences = sqliteTable("workspace_preferences", {
  id: integer("id").primaryKey().default(1),
  globalIncludeArchived: integer("global_include_archived", { mode: "boolean" })
    .notNull()
    .default(false),
  globalEnvironmentMode: text("global_environment_mode")
    .notNull()
    .default("paper"),
  defaultSearchProviderId: text("default_search_provider_id").references(
    () => providerAccounts.id,
    {
      onDelete: "set null",
    },
  ),
  allocationEnforcementOverride: text("allocation_enforcement_override"),
  defaultModelProviderKey: text("default_model_provider_key")
    .notNull()
    .default(""),
  defaultModelModelId: text("default_model_model_id").notNull().default(""),
  defaultModelReasoningLevel: text("default_model_reasoning_level")
    .notNull()
    .default("off"),
  updatedAt: text("updated_at").notNull(),
});

export const globalPresets = sqliteTable("global_presets", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  isBuiltIn: integer("is_built_in", { mode: "boolean" })
    .notNull()
    .default(false),
  createdAt: integer("created_at").notNull(),
  presetJson: text("preset_json").notNull(),
});

export const riskPresets = sqliteTable("risk_presets", {
  id: text("id").primaryKey(),
  label: text("label").notNull(),
  isBuiltIn: integer("is_built_in", { mode: "boolean" })
    .notNull()
    .default(false),
  presetJson: text("preset_json").notNull(),
});

export const timeframePresets = sqliteTable("timeframe_presets", {
  id: text("id").primaryKey(),
  label: text("label").notNull(),
  isBuiltIn: integer("is_built_in", { mode: "boolean" })
    .notNull()
    .default(false),
  presetJson: text("preset_json").notNull(),
});

export const researchPosturePresets = sqliteTable("research_posture_presets", {
  id: text("id").primaryKey(),
  label: text("label").notNull(),
  isBuiltIn: integer("is_built_in", { mode: "boolean" })
    .notNull()
    .default(false),
  presetJson: text("preset_json").notNull(),
});

export const tradeRulePresets = sqliteTable("trade_rule_presets", {
  id: text("id").primaryKey(),
  label: text("label").notNull(),
  isBuiltIn: integer("is_built_in", { mode: "boolean" })
    .notNull()
    .default(false),
  presetJson: text("preset_json").notNull(),
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

export const trades = sqliteTable(
  "trades",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    brokerAccountId: text("broker_account_id").references(
      () => brokerAccounts.id,
      { onDelete: "set null" },
    ),
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
    executionStrategy: text("execution_strategy"),
    status: text("status").notNull(),
    openedAt: text("opened_at"),
    closedAt: text("closed_at"),
    finalPnlUsd: real("final_pnl_usd"),
    aiCostUsd: real("ai_cost_usd").notNull().default(0),
    confidenceScore: real("confidence_score"),
    brokerOrderId: text("broker_order_id"),
    highWaterMarkPrice: real("high_water_mark_price"),
    exitReason: text("exit_reason"),
    clientOrderId: text("client_order_id"),
    closeMarketSnapshotJson: text("close_market_snapshot_json"),
    createdAt: text("created_at").notNull(),
  },
  (table) => ({
    sessionIdIdx: index("idx_trades_session_id").on(table.sessionId),
    statusIdx: index("idx_trades_status").on(table.status),
    instrumentIdx: index("idx_trades_instrument").on(
      table.instrumentSymbol,
      table.brokerAccountId,
      table.status,
    ),
  }),
);

export const agentRuns = sqliteTable(
  "agent_runs",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    tradeId: text("trade_id").references(() => trades.id, {
      onDelete: "cascade",
    }),
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
  },
  (table) => ({
    sessionIdIdx: index("idx_agent_runs_session").on(table.sessionId),
  }),
);

export const agentMessages = sqliteTable(
  "agent_messages",
  {
    id: text("id").primaryKey(),
    agentRunId: text("agent_run_id")
      .notNull()
      .references(() => agentRuns.id, { onDelete: "cascade" }),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    tradeId: text("trade_id").references(() => trades.id, {
      onDelete: "cascade",
    }),
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
  },
  (table) => ({
    agentRunIdIdx: index("idx_agent_messages_run").on(table.agentRunId),
    tradeIdIdx: index("idx_agent_messages_trade").on(table.tradeId),
  }),
);

export const sessionInstrumentCache = sqliteTable("session_instrument_cache", {
  sessionId: text("session_id")
    .primaryKey()
    .references(() => sessions.id, { onDelete: "cascade" }),
  instruments: text("instruments").notNull(),
  definitionHash: text("definition_hash").notNull(),
  selectedAt: text("selected_at").notNull(),
  selectorAgentRunId: text("selector_agent_run_id").references(
    () => agentRuns.id,
    { onDelete: "set null" },
  ),
  cycleId: text("cycle_id").notNull().default(""),
  researchBriefsJson: text("research_briefs_json"),
  researchGeneratedAt: text("research_generated_at"),
  expiresAt: text("expires_at"),
});

export const apiCallLog = sqliteTable(
  "api_call_log",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id").references(() => sessions.id, {
      onDelete: "cascade",
    }),
    tradeId: text("trade_id").references(() => trades.id, {
      onDelete: "cascade",
    }),
    cycleId: text("cycle_id"),
    provider: text("provider").notNull(),
    endpoint: text("endpoint").notNull(),
    callType: text("call_type").notNull(),
    creditsUsed: integer("credits_used"),
    costUsd: real("cost_usd"),
    latencyMs: integer("latency_ms").notNull(),
    status: text("status").notNull(),
    fromCache: integer("from_cache", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: text("created_at").notNull(),
  },
  (table) => ({
    sessionIdIdx: index("idx_api_call_log_session").on(table.sessionId),
    createdAtIdx: index("idx_api_call_log_created").on(table.createdAt),
  }),
);

export const tradeAutopsies = sqliteTable(
  "trade_autopsies",
  {
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
  },
  (table) => ({
    tradeIdIdx: index("idx_trade_autopsies_trade").on(table.tradeId),
  }),
);

export const events = sqliteTable(
  "events",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id").references(() => sessions.id, {
      onDelete: "set null",
    }),
    tradeId: text("trade_id").references(() => trades.id, {
      onDelete: "set null",
    }),
    cycleId: text("cycle_id"),
    level: text("level").notNull(),
    agentType: text("agent_type"),
    message: text("message").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => ({
    sessionIdIdx: index("idx_events_session_id").on(table.sessionId),
    cycleIdIdx: index("idx_events_cycle_id").on(table.cycleId),
  }),
);

export const tradeApprovals = sqliteTable(
  "trade_approvals",
  {
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
  },
  (table) => ({
    sessionStatusIdx: index("idx_approvals_session").on(
      table.sessionId,
      table.status,
    ),
  }),
);

export const developerSettings = sqliteTable("developer_settings", {
  id: text("id").primaryKey().default("singleton"),
  defaultEventMinLevel: text("default_event_min_level")
    .notNull()
    .default("INFO"),
  defaultTimeWindowMinutes: integer("default_time_window_minutes")
    .notNull()
    .default(60),
  defaultSourceFiltersJson: text("default_source_filters_json")
    .notNull()
    .default("[]"),
  includePromptsInExports: integer("include_prompts_in_exports", {
    mode: "boolean",
  })
    .notNull()
    .default(false),
  includeToolPayloadsInExports: integer("include_tool_payloads_in_exports", {
    mode: "boolean",
  })
    .notNull()
    .default(true),
});

export const runtimeLogOverrides = sqliteTable("runtime_log_overrides", {
  id: text("id").primaryKey(),
  scopeType: text("scope_type").notNull(),
  scopeId: text("scope_id"),
  mainLogLevel: text("main_log_level").notNull(),
  eventMinLevel: text("event_min_level").notNull(),
  expiresAt: text("expires_at"),
  createdAt: text("created_at").notNull(),
});

export const capitalReservations = sqliteTable(
  "capital_reservations",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    approvalId: text("approval_id").references(() => tradeApprovals.id, {
      onDelete: "set null",
    }),
    tradeId: text("trade_id").references(() => trades.id, {
      onDelete: "set null",
    }),
    amountUsd: real("amount_usd").notNull(),
    reason: text("reason").notNull(),
    status: text("status").notNull().default("reserved"),
    createdAt: text("created_at").notNull(),
    releasedAt: text("released_at"),
  },
  (table) => ({
    sessionStatusIdx: index("idx_capital_reservations_session").on(
      table.sessionId,
      table.status,
    ),
    approvalIdIdx: index("idx_capital_reservations_approval").on(
      table.approvalId,
    ),
  }),
);
