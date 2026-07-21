import {
  check,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

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
  mockExecutionTier: text("mock_execution_tier"),
  secretRef: text("secret_ref").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/**
 * Persisted paper/ghost balance for venues without a sandbox (Polymarket,
 * Kraken validate-only). One row per broker account.
 */
export const paperBalances = sqliteTable("paper_balances", {
  accountId: text("account_id")
    .primaryKey()
    .references(() => brokerAccounts.id, { onDelete: "cascade" }),
  currency: text("currency").notNull().default("USD"),
  balance: real("balance").notNull(),
  startingBalance: real("starting_balance").notNull(),
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
    experienceId: text("experience_id").notNull().default("edgar-catalyst"),
    strategyConfigJson: text("strategy_config_json"),
    overridesJson: text("overrides_json"),
    liveReadinessAcknowledgedAt: text("live_readiness_acknowledged_at"),
    /** V2 session input revision for optimistic concurrency. */
    sessionInputRevision: integer("session_input_revision")
      .notNull()
      .default(0),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({
    statusIdx: index("idx_sessions_status").on(table.status),
    isFocusedIdx: index("idx_sessions_is_focused").on(table.isFocused),
  }),
);

export const signalSources = sqliteTable("signal_sources", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  configJson: text("config_json").notNull().default("{}"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const signalEvents = sqliteTable(
  "signal_events",
  {
    id: text("id").primaryKey(),
    sourceId: text("source_id"),
    sourceType: text("source_type").notNull(),
    ticker: text("ticker").notNull(),
    companyName: text("company_name"),
    documentUrl: text("document_url"),
    accessionNumber: text("accession_number"),
    payloadJson: text("payload_json").notNull().default("{}"),
    filedAt: text("filed_at").notNull(),
    detectedAt: text("detected_at").notNull(),
    dispatchStatus: text("dispatch_status").notNull(),
    dispatchCompletedAt: text("dispatch_completed_at"),
    sourceDroppedReason: text("source_dropped_reason"),
    /** MarketSignal kind. */
    kind: text("kind"),
    /**
     * Legacy typed-payload column from dual-write era.
     * payload_json is canonical; kept for historical rows.
     */
    payloadV2: text("payload_v2"),
    /** Mandatory dedupe key (backfilled for legacy rows). */
    dedupeKey: text("dedupe_key"),
    /** ISO-8601 duration TTL for delivery expiry. */
    ttl: text("ttl"),
    /** When the information came into being (may differ from detectedAt). */
    occurredAt: text("occurred_at"),
    /** V2 origin: source_definition | scheduled_scan | manual | legacy */
    originKind: text("origin_kind"),
    originId: text("origin_id"),
    scheduleGroupKey: text("schedule_group_key"),
  },
  (table) => ({
    sourceIdx: index("idx_signal_events_source").on(table.sourceId),
    sourceAccessionUnique: uniqueIndex("idx_signal_events_accession")
      .on(table.sourceId, table.accessionNumber)
      .where(sql`${table.accessionNumber} is not null`),
    sourceDedupeUnique: uniqueIndex("idx_signal_events_dedupe")
      .on(table.sourceId, table.dedupeKey)
      .where(sql`${table.dedupeKey} is not null`),
    originIdx: index("idx_signal_events_origin").on(
      table.originKind,
      table.originId,
    ),
  }),
);

export const sessionSignalDeliveries = sqliteTable(
  "session_signal_deliveries",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    signalEventId: text("signal_event_id")
      .notNull()
      .references(() => signalEvents.id, { onDelete: "cascade" }),
    sourceId: text("source_id"),
    queuePositionAtEnqueue: integer("queue_position_at_enqueue").notNull(),
    status: text("status").notNull(),
    statusBucket: text("status_bucket").notNull(),
    enqueuedAt: text("enqueued_at").notNull(),
    startedAt: text("started_at"),
    finishedAt: text("finished_at"),
    expiresAt: text("expires_at"),
    tradeId: text("trade_id"),
    dropReason: text("drop_reason"),
    notesJson: text("notes_json"),
    /** V2: which session input subscription caused this delivery. */
    subscriptionId: text("subscription_id"),
  },
  (table) => ({
    sessionIdx: index("idx_ssd_session").on(table.sessionId),
    statusIdx: index("idx_ssd_status").on(table.sessionId, table.statusBucket),
    subscriptionIdx: index("idx_ssd_subscription").on(table.subscriptionId),
  }),
);

export const signalDeadLetters = sqliteTable(
  "signal_dead_letters",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    signalEventId: text("signal_event_id")
      .notNull()
      .references(() => signalEvents.id, { onDelete: "cascade" }),
    sourceId: text("source_id").notNull(),
    sourceType: text("source_type").notNull(),
    ticker: text("ticker").notNull(),
    instrumentClass: text("instrument_class"),
    reason: text("reason").notNull(),
    detailJson: text("detail_json").notNull().default("{}"),
    createdAt: text("created_at").notNull(),
    replayedAt: text("replayed_at"),
    resolvedDeliveryId: text("resolved_delivery_id"),
  },
  (table) => ({
    sessionIdx: index("idx_signal_dead_letters_session").on(table.sessionId),
    signalEventIdx: index("idx_signal_dead_letters_signal_event").on(
      table.signalEventId,
    ),
  }),
);

export const cikTickerCache = sqliteTable("cik_ticker_cache", {
  cik: text("cik").primaryKey(),
  ticker: text("ticker"),
  lookedUpAt: text("looked_up_at").notNull(),
});

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

export const decisionTraces = sqliteTable(
  "decision_traces",
  {
    // One row per trade cycle. Keyed by cycle because a cycle rejected at
    // candidate validation never produces a trade row; tradeId is linked later.
    cycleId: text("cycle_id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    tradeId: text("trade_id").references(() => trades.id, {
      onDelete: "set null",
    }),
    instrumentSymbol: text("instrument_symbol").notNull(),
    traceJson: text("trace_json").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({
    sessionIdx: index("idx_decision_traces_session").on(table.sessionId),
    tradeIdx: index("idx_decision_traces_trade").on(table.tradeId),
  }),
);

/** Versioned SessionStrategyConfigDoc per session (config diet). */
export const sessionStrategyConfigs = sqliteTable("session_strategy_configs", {
  sessionId: text("session_id")
    .primaryKey()
    .references(() => sessions.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  schemaVersion: integer("schema_version").notNull(),
  doc: text("doc", { mode: "json" }).notNull(),
  updatedAt: text("updated_at").notNull(),
});

/**
 * Unified presets replacing global/risk/timeframe/research/trade_rule presets.
 * `kind`: 'full' | 'risk' | 'timeframe' | 'research' | 'rules' | 'ai'
 * `doc`: partial SessionStrategyConfigDoc matching kind.
 */
export const configPresets = sqliteTable("config_presets", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  kind: text("kind").notNull(),
  doc: text("doc", { mode: "json" }).notNull(),
  builtin: integer("builtin", { mode: "boolean" }).notNull().default(false),
  updatedAt: text("updated_at").notNull(),
});

/** Prior docs appended on every write — audit trail + rollback. */
export const sessionStrategyConfigHistory = sqliteTable(
  "session_strategy_config_history",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id").notNull(),
    version: integer("version").notNull(),
    doc: text("doc", { mode: "json" }).notNull(),
    savedAt: text("saved_at").notNull(),
  },
);

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
    lowWaterMarkPrice: real("low_water_mark_price"),
    exitReason: text("exit_reason"),
    /** How the terminal close was detected: `stream` (pushed by the broker feed) or `poll` (found on the next snapshot poll). Null for legacy rows closed before this was tracked. */
    closureSource: text("closure_source"),
    clientOrderId: text("client_order_id"),
    closeMarketSnapshotJson: text("close_market_snapshot_json"),
    mfeUsd: real("mfe_usd"),
    maeUsd: real("mae_usd"),
    spreadAtEntryBps: real("spread_at_entry_bps"),
    slippageBps: real("slippage_bps"),
    commissionUsd: real("commission_usd"),
    borrowCostUsd: real("borrow_cost_usd"),
    executionCostUsd: real("execution_cost_usd"),
    takeProfitTouchedAt: text("take_profit_touched_at"),
    stopTouchedAt: text("stop_touched_at"),
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
    // Hub trades list / autopsy filters order by opened_at / closed_at.
    openedAtIdx: index("idx_trades_opened_at").on(table.openedAt),
    closedAtIdx: index("idx_trades_closed_at").on(table.closedAt),
    statusOpenedIdx: index("idx_trades_status_opened").on(
      table.status,
      table.openedAt,
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

/** Discriminator: trade | period autopsy kind (not global|session). */
export const autopsies = sqliteTable(
  "autopsies",
  {
    id: text("id").primaryKey(),
    scope: text("scope").notNull(),
    tradeId: text("trade_id").references(() => trades.id, {
      onDelete: "cascade",
    }),
    summary: text("summary"),
    /** Former period row audience: global | session. */
    periodScope: text("period_scope"),
    windowStart: text("window_start"),
    windowEnd: text("window_end"),
    filtersJson: text("filters_json"),
    tradeCount: integer("trade_count"),
    tradeIdsJson: text("trade_ids_json"),
    totalCostUsd: real("total_cost_usd"),
    sessionId: text("session_id").references(() => sessions.id, {
      onDelete: "set null",
    }),
    modelId: text("model_id").notNull(),
    summaryStructuredJson: text("summary_structured_json")
      .notNull()
      .default("{}"),
    phaseTracesJson: text("phase_traces_json").notNull().default("[]"),
    qualityGrade: text("quality_grade"),
    qualityScore: real("quality_score"),
    isFallback: integer("is_fallback", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: text("created_at").notNull(),
    createdBy: text("created_by").notNull().default("user"),
  },
  (table) => ({
    scopeCheck: check(
      "autopsies_scope_check",
      sql`${table.scope} IN ('trade', 'period')`,
    ),
    scopeIdx: index("idx_autopsies_scope").on(table.scope),
    tradeIdIdx: index("idx_autopsies_trade").on(table.tradeId),
    periodScopeIdx: index("idx_autopsies_period_scope").on(table.periodScope),
    sessionIdx: index("idx_autopsies_session").on(table.sessionId),
    createdIdx: index("idx_autopsies_created").on(table.createdAt),
  }),
);

export const autopsyLessons = sqliteTable(
  "autopsy_lessons",
  {
    id: text("id").primaryKey(),
    autopsyId: text("autopsy_id").references(() => autopsies.id, {
      onDelete: "cascade",
    }),
    tradeId: text("trade_id").references(() => trades.id, {
      onDelete: "cascade",
    }),
    sessionId: text("session_id").references(() => sessions.id, {
      onDelete: "set null",
    }),
    lesson: text("lesson").notNull(),
    severity: text("severity").notNull().default("medium"),
    category: text("category").notNull().default("strategy"),
    proposedFix: text("proposed_fix").notNull().default(""),
    status: text("status").notNull().default("pending"),
    recurrenceCount: integer("recurrence_count").notNull().default(0),
    source: text("source").notNull().default("trade"),
    scope: text("scope").notNull().default("session"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    validatedAt: text("validated_at"),
  },
  (table) => ({
    autopsyIdx: index("idx_autopsy_lessons_autopsy").on(table.autopsyId),
    sessionIdx: index("idx_autopsy_lessons_session").on(table.sessionId),
    statusIdx: index("idx_autopsy_lessons_status").on(table.status),
    scopeIdx: index("idx_autopsy_lessons_scope").on(table.scope),
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
    // Dashboard / hub event feeds: ORDER BY created_at DESC LIMIT N
    createdAtIdx: index("idx_events_created_at").on(table.createdAt),
    sessionCreatedIdx: index("idx_events_session_created").on(
      table.sessionId,
      table.createdAt,
    ),
  }),
);

export const sessionActivity = sqliteTable("session_activity", {
  sessionId: text("session_id")
    .primaryKey()
    .references(() => sessions.id, { onDelete: "cascade" }),
  activity: text("activity").notNull(),
  conditionsJson: text("conditions_json").notNull().default("[]"),
  updatedAt: text("updated_at").notNull(),
});

export const sessionActivityTransitions = sqliteTable(
  "session_activity_transitions",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    activity: text("activity").notNull(),
    conditionsJson: text("conditions_json").notNull().default("[]"),
    createdAt: text("created_at").notNull(),
  },
  (table) => ({
    sessionCreatedIdx: index("idx_session_activity_transitions_session").on(
      table.sessionId,
      table.createdAt,
    ),
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

export const experienceExperiments = sqliteTable(
  "experience_experiments",
  {
    id: text("id").primaryKey(),
    experienceId: text("experience_id").notNull(),
    configHash: text("config_hash").notNull(),
    datasetWindowStart: text("dataset_window_start"),
    datasetWindowEnd: text("dataset_window_end"),
    metricsJson: text("metrics_json").notNull().default("{}"),
    notes: text("notes").notNull().default(""),
    verdict: text("verdict").notNull().default("inconclusive"),
    createdAt: text("created_at").notNull(),
  },
  (table) => ({
    experienceIdx: index("idx_experience_experiments_experience").on(
      table.experienceId,
      table.createdAt,
    ),
  }),
);

export const researchSummaries = sqliteTable(
  "research_summaries",
  {
    id: text("id").primaryKey(),
    period: text("period").notNull(),
    summaryJson: text("summary_json").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => ({
    periodIdx: index("idx_research_summaries_period").on(
      table.period,
      table.createdAt,
    ),
  }),
);

/**
 * Point-in-time record of every signal evaluation — traded AND skipped (P1/P3).
 * Skipped opportunities MUST be recorded: the model is only proven selective by
 * comparing traded setups against skipped ones.
 */
export const signalObservations = sqliteTable(
  "signal_observations",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id").references(() => sessions.id, {
      onDelete: "set null",
    }),
    experienceId: text("experience_id").notNull(),
    signalId: text("signal_id").notNull(),
    cycleId: text("cycle_id"),
    instrumentSymbol: text("instrument_symbol").notNull(),
    instrumentClass: text("instrument_class").notNull(),
    /** buy | sell | skip — the action the engine actually took. */
    action: text("action").notNull(),
    eventTime: text("event_time").notNull(),
    observedAt: text("observed_at").notNull(),
    sourceUri: text("source_uri"),
    featureJson: text("feature_json").notNull().default("{}"),
    /** Decision + EdgeEstimate snapshot at observation time. */
    decisionJson: text("decision_json"),
    modelVersion: text("model_version"),
    /** Denormalized from the research contract for the label builder. */
    labelHorizon: text("label_horizon").notNull(),
    labelBenchmark: text("label_benchmark").notNull(),
    /** Reference entry price for forward-return labeling. */
    referencePrice: real("reference_price"),
    /** When the label can be computed; null for resolution-horizon events. */
    labelReadyAt: text("label_ready_at"),
    createdAt: text("created_at").notNull(),
  },
  (table) => ({
    experienceIdx: index("idx_signal_observations_experience").on(
      table.experienceId,
      table.eventTime,
    ),
    sessionIdx: index("idx_signal_observations_session").on(table.sessionId),
    labelReadyIdx: index("idx_signal_observations_label_ready").on(
      table.labelReadyAt,
    ),
  }),
);

/** Forward-return labels for observations, computed after the horizon passes. */
export const signalLabels = sqliteTable(
  "signal_labels",
  {
    observationId: text("observation_id")
      .notNull()
      .references(() => signalObservations.id, { onDelete: "cascade" }),
    horizon: text("horizon").notNull(),
    benchmark: text("benchmark").notNull(),
    grossReturnBps: real("gross_return_bps"),
    costBps: real("cost_bps"),
    netReturnBps: real("net_return_bps"),
    benchmarkReturnBps: real("benchmark_return_bps"),
    maxFavorableBps: real("max_favorable_bps"),
    maxAdverseBps: real("max_adverse_bps"),
    /** Binary win label for probability-forecast experiences (0/1), nullable. */
    outcomeWin: integer("outcome_win"),
    labelReadyAt: text("label_ready_at").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => ({
    pk: primaryKey({
      columns: [table.observationId, table.horizon, table.benchmark],
    }),
  }),
);

/** Versioned model artifacts for an experience (P7). */
export const modelVersions = sqliteTable(
  "model_versions",
  {
    id: text("id").primaryKey(),
    experienceId: text("experience_id").notNull(),
    modelKind: text("model_kind").notNull(),
    featureSchemaJson: text("feature_schema_json").notNull(),
    trainingWindowStart: text("training_window_start").notNull(),
    trainingWindowEnd: text("training_window_end").notNull(),
    calibrationJson: text("calibration_json").notNull().default("{}"),
    artifactUri: text("artifact_uri"),
    checksum: text("checksum"),
    createdAt: text("created_at").notNull(),
  },
  (table) => ({
    experienceIdx: index("idx_model_versions_experience").on(
      table.experienceId,
      table.createdAt,
    ),
  }),
);

/** Locked backtest runs over a contract + model version (P7). */
export const backtestRuns = sqliteTable(
  "backtest_runs",
  {
    id: text("id").primaryKey(),
    experienceId: text("experience_id").notNull(),
    modelVersionId: text("model_version_id"),
    contractHash: text("contract_hash").notNull(),
    windowStart: text("window_start").notNull(),
    windowEnd: text("window_end").notNull(),
    foldConfigJson: text("fold_config_json").notNull(),
    costModelJson: text("cost_model_json").notNull(),
    metricsJson: text("metrics_json").notNull(),
    verdict: text("verdict").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => ({
    experienceIdx: index("idx_backtest_runs_experience").on(
      table.experienceId,
      table.createdAt,
    ),
  }),
);

/** Promotion decisions between tiers, with the evidence behind them (P7). */
export const promotionDecisions = sqliteTable(
  "promotion_decisions",
  {
    id: text("id").primaryKey(),
    experienceId: text("experience_id").notNull(),
    modelVersionId: text("model_version_id"),
    fromTier: text("from_tier").notNull(),
    toTier: text("to_tier").notNull(),
    decision: text("decision").notNull(),
    evidenceJson: text("evidence_json").notNull(),
    decidedAt: text("decided_at").notNull(),
  },
  (table) => ({
    experienceIdx: index("idx_promotion_decisions_experience").on(
      table.experienceId,
      table.decidedAt,
    ),
  }),
);

export const controlConversations = sqliteTable(
  "control_conversations",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    scopeKind: text("scope_kind").notNull().default("workspace"),
    scopeSessionId: text("scope_session_id").references(() => sessions.id, {
      onDelete: "set null",
    }),
    autoApprovedJson: text("auto_approved_json").notNull().default("[]"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({
    updatedAtIdx: index("idx_control_conversations_updated").on(
      table.updatedAt,
    ),
  }),
);

export const controlMessages = sqliteTable(
  "control_messages",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => controlConversations.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    content: text("content").notNull(),
    status: text("status").notNull().default("complete"),
    turnId: text("turn_id").notNull(),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    costUsd: real("cost_usd"),
    createdAt: text("created_at").notNull(),
  },
  (table) => ({
    conversationIdx: index("idx_control_messages_conversation").on(
      table.conversationId,
      table.createdAt,
    ),
  }),
);

export const controlToolCalls = sqliteTable(
  "control_tool_calls",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => controlConversations.id, { onDelete: "cascade" }),
    turnId: text("turn_id").notNull(),
    capability: text("capability").notNull(),
    kind: text("kind").notNull(),
    inputJson: text("input_json").notNull(),
    resultJson: text("result_json"),
    status: text("status").notNull().default("running"),
    confirmation: text("confirmation"),
    affectedEntity: text("affected_entity"),
    startedAt: text("started_at").notNull(),
    finishedAt: text("finished_at"),
  },
  (table) => ({
    conversationIdx: index("idx_control_tool_calls_conversation").on(
      table.conversationId,
    ),
    affectedEntityIdx: index("idx_control_tool_calls_affected").on(
      table.affectedEntity,
    ),
  }),
);

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

/** Point-in-time OHLCV store shared by live cycles and backtests. */
export const ohlcvBars = sqliteTable(
  "ohlcv_bars",
  {
    id: text("id").primaryKey(),
    symbol: text("symbol").notNull(),
    instrumentClass: text("instrument_class").notNull(),
    timeframe: text("timeframe").notNull(),
    ts: text("ts").notNull(),
    open: real("open").notNull(),
    high: real("high").notNull(),
    low: real("low").notNull(),
    close: real("close").notNull(),
    volume: real("volume"),
    provider: text("provider").notNull(),
    ingestedAt: text("ingested_at").notNull(),
  },
  (table) => ({
    symbolTfTsUnique: uniqueIndex("idx_ohlcv_bars_symbol_tf_ts").on(
      table.symbol,
      table.timeframe,
      table.ts,
    ),
    symbolTfIdx: index("idx_ohlcv_bars_symbol_tf").on(
      table.symbol,
      table.timeframe,
    ),
  }),
);

export const dataCoverage = sqliteTable(
  "data_coverage",
  {
    id: text("id").primaryKey(),
    symbol: text("symbol").notNull(),
    timeframe: text("timeframe").notNull(),
    firstTs: text("first_ts").notNull(),
    lastTs: text("last_ts").notNull(),
    provider: text("provider").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({
    symbolTfUnique: uniqueIndex("idx_data_coverage_symbol_tf").on(
      table.symbol,
      table.timeframe,
    ),
  }),
);

/** Configurable experience-input catalog (V2). */

export const experienceTemplates = sqliteTable("experience_templates", {
  id: text("id").primaryKey(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const experienceTemplateRevisions = sqliteTable(
  "experience_template_revisions",
  {
    templateId: text("template_id")
      .notNull()
      .references(() => experienceTemplates.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    status: text("status").notNull(),
    displayName: text("display_name").notNull(),
    description: text("description").notNull(),
    pipelineId: text("pipeline_id").notNull(),
    strategyId: text("strategy_id"),
    promptVariantKey: text("prompt_variant_key").notNull(),
    brokerRequirement: text("broker_requirement").notNull(),
    inputContractJson: text("input_contract_json").notNull(),
    defaultPresetIdsJson: text("default_preset_ids_json").notNull(),
    researchContractJson: text("research_contract_json").notNull(),
    universePolicy: text("universe_policy").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.templateId, table.version] }),
    statusIdx: index("idx_experience_template_revisions_status").on(
      table.templateId,
      table.status,
    ),
  }),
);

export const sourceDefinitions = sqliteTable("source_definitions", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  integrationId: text("integration_id"),
  outputContractId: text("output_contract_id").notNull(),
  configSchemaVersion: integer("config_schema_version").notNull().default(1),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const sourceDefinitionRevisions = sqliteTable(
  "source_definition_revisions",
  {
    sourceDefinitionId: text("source_definition_id")
      .notNull()
      .references(() => sourceDefinitions.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull(),
    configJson: text("config_json").notNull().default("{}"),
    createdAt: text("created_at").notNull(),
  },
  (table) => ({
    pk: primaryKey({
      columns: [table.sourceDefinitionId, table.revision],
    }),
  }),
);

export const instrumentSets = sqliteTable("instrument_sets", {
  id: text("id").primaryKey(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const instrumentSetRevisions = sqliteTable(
  "instrument_set_revisions",
  {
    setId: text("set_id")
      .notNull()
      .references(() => instrumentSets.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull(),
    status: text("status").notNull(),
    name: text("name").notNull(),
    instrumentClass: text("instrument_class").notNull(),
    mode: text("mode").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.setId, table.revision] }),
    statusIdx: index("idx_instrument_set_revisions_status").on(
      table.setId,
      table.status,
    ),
  }),
);

export const instrumentSetMembers = sqliteTable(
  "instrument_set_members",
  {
    setId: text("set_id").notNull(),
    setRevision: integer("set_revision").notNull(),
    canonicalId: text("canonical_id").notNull(),
    displaySymbol: text("display_symbol").notNull(),
    venue: text("venue"),
  },
  (table) => ({
    pk: primaryKey({
      columns: [table.setId, table.setRevision, table.canonicalId],
    }),
    setRevIdx: index("idx_instrument_set_members_set_rev").on(
      table.setId,
      table.setRevision,
    ),
  }),
);

export const experienceInputProfiles = sqliteTable(
  "experience_input_profiles",
  {
    id: text("id").primaryKey(),
    templateId: text("template_id").notNull(),
    templateVersion: integer("template_version").notNull(),
    mode: text("mode").notNull(),
    name: text("name").notNull(),
    revision: integer("revision").notNull().default(1),
    /** Mode-specific payload JSON (source/set/cadence/params). */
    payloadJson: text("payload_json").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({
    templateIdx: index("idx_experience_input_profiles_template").on(
      table.templateId,
      table.templateVersion,
    ),
  }),
);

export const sessionInputSubscriptions = sqliteTable(
  "session_input_subscriptions",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    templateId: text("template_id").notNull(),
    templateVersion: integer("template_version").notNull(),
    mode: text("mode").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    createdFromProfileId: text("created_from_profile_id"),
    revision: integer("revision").notNull().default(1),
    /** Event: sourceDefinitionId; Scheduled: instrumentSetId — typed cols below. */
    sourceDefinitionId: text("source_definition_id"),
    sourceRevision: integer("source_revision"),
    instrumentSetId: text("instrument_set_id"),
    instrumentSetRevision: integer("instrument_set_revision"),
    cadenceJson: text("cadence_json"),
    analysisTimeframe: text("analysis_timeframe").notNull(),
    marketCalendarId: text("market_calendar_id"),
    strategyParametersJson: text("strategy_parameters_json"),
    filtersJson: text("filters_json"),
    usesUnvalidatedUniverse: integer("uses_unvalidated_universe", {
      mode: "boolean",
    })
      .notNull()
      .default(false),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({
    sessionIdx: index("idx_session_input_subscriptions_session").on(
      table.sessionId,
    ),
    sourceIdx: index("idx_session_input_subscriptions_source").on(
      table.sourceDefinitionId,
      table.enabled,
    ),
    setIdx: index("idx_session_input_subscriptions_set").on(
      table.instrumentSetId,
      table.enabled,
    ),
  }),
);

export const scheduleRuntimeStates = sqliteTable("schedule_runtime_states", {
  groupKey: text("group_key").primaryKey(),
  nextRunAt: text("next_run_at"),
  lastStartedAt: text("last_started_at"),
  lastFinishedAt: text("last_finished_at"),
  lastSuccessAt: text("last_success_at"),
  lastDurationMs: integer("last_duration_ms"),
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  lastError: text("last_error"),
  /** Per-instrument scan diagnostics for the last fire (JSON). */
  lastScanSummaryJson: text("last_scan_summary_json").notNull().default("{}"),
  subscriptionIdsJson: text("subscription_ids_json").notNull().default("[]"),
  instrumentCount: integer("instrument_count").notNull().default(0),
  updatedAt: text("updated_at").notNull(),
});

/**
 * Latest poll health per live signal source. Survives shutdown so quiet feeds
 * can be distinguished from broken ones.
 */
export const signalSourceRuntimeStates = sqliteTable(
  "signal_source_runtime_states",
  {
    sourceId: text("source_id")
      .primaryKey()
      .references(() => signalSources.id, { onDelete: "cascade" }),
    status: text("status").notNull(),
    lastPollAt: text("last_poll_at"),
    lastSuccessAt: text("last_success_at"),
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    lastError: text("last_error"),
    lastOutcome: text("last_outcome"),
    httpStatus: integer("http_status"),
    detected: integer("detected").notNull().default(0),
    passed: integer("passed").notNull().default(0),
    dropped: integer("dropped").notNull().default(0),
    errorsJson: text("errors_json").notNull().default("[]"),
    updatedAt: text("updated_at").notNull(),
  },
);

/** Append-only poll history for post-run forensics. */
export const signalSourcePolls = sqliteTable(
  "signal_source_polls",
  {
    id: text("id").primaryKey(),
    sourceId: text("source_id")
      .notNull()
      .references(() => signalSources.id, { onDelete: "cascade" }),
    polledAt: text("polled_at").notNull(),
    outcome: text("outcome").notNull(),
    httpStatus: integer("http_status"),
    detected: integer("detected").notNull().default(0),
    passed: integer("passed").notNull().default(0),
    dropped: integer("dropped").notNull().default(0),
    errorsJson: text("errors_json").notNull().default("[]"),
    durationMs: integer("duration_ms").notNull().default(0),
    status: text("status").notNull(),
  },
  (table) => ({
    sourcePolledIdx: index("idx_signal_source_polls_source_polled").on(
      table.sourceId,
      table.polledAt,
    ),
  }),
);

export const migrationQuarantine = sqliteTable("migration_quarantine", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  sessionId: text("session_id"),
  sourceId: text("source_id"),
  reason: text("reason").notNull(),
  detailJson: text("detail_json").notNull().default("{}"),
  createdAt: text("created_at").notNull(),
});

/** Human-reviewable Polymarket↔Kalshi market matches for cross-venue dislocation. */
export const crossVenueMarketLinks = sqliteTable(
  "cross_venue_market_links",
  {
    id: text("id").primaryKey(),
    polymarketId: text("polymarket_id").notNull(),
    kalshiTicker: text("kalshi_ticker").notNull(),
    confidence: real("confidence").notNull(),
    approved: integer("approved", { mode: "boolean" }).notNull().default(false),
    questionPolymarket: text("question_polymarket"),
    questionKalshi: text("question_kalshi"),
    resolutionDate: text("resolution_date"),
    matchMethod: text("match_method").notNull().default("manual"),
    notes: text("notes"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({
    pairUnique: uniqueIndex("idx_cross_venue_pair").on(
      table.polymarketId,
      table.kalshiTicker,
    ),
    approvedIdx: index("idx_cross_venue_approved").on(table.approved),
  }),
);

/** Perp funding-rate history for crypto funding/basis scans + backtests. */
export const fundingRates = sqliteTable(
  "funding_rates",
  {
    id: text("id").primaryKey(),
    venue: text("venue").notNull(),
    symbol: text("symbol").notNull(),
    ts: text("ts").notNull(),
    rate: real("rate").notNull(),
    ingestedAt: text("ingested_at").notNull(),
  },
  (table) => ({
    venueSymbolTsUnique: uniqueIndex("idx_funding_rates_venue_symbol_ts").on(
      table.venue,
      table.symbol,
      table.ts,
    ),
    symbolTsIdx: index("idx_funding_rates_symbol_ts").on(
      table.symbol,
      table.ts,
    ),
  }),
);

/** Macro + earnings calendar events (FOMC/CPI seeds + earnings ingest). */
export const calendarEvents = sqliteTable(
  "calendar_events",
  {
    id: text("id").primaryKey(),
    eventType: text("event_type").notNull(),
    scheduledAt: text("scheduled_at").notNull(),
    symbol: text("symbol"),
    title: text("title"),
    source: text("source").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({
    scheduledIdx: index("idx_calendar_events_scheduled").on(table.scheduledAt),
    symbolScheduledIdx: index("idx_calendar_events_symbol_scheduled").on(
      table.symbol,
      table.scheduledAt,
    ),
  }),
);

/** Ingested Form 4 transactions for insider-cluster detection + backtest. */
export const form4Transactions = sqliteTable(
  "form4_transactions",
  {
    id: text("id").primaryKey(),
    accessionNumber: text("accession_number").notNull(),
    cik: text("cik").notNull(),
    ticker: text("ticker"),
    companyName: text("company_name"),
    insiderName: text("insider_name").notNull(),
    role: text("role").notNull(),
    transactionCode: text("transaction_code").notNull(),
    shares: real("shares").notNull(),
    pricePerShare: real("price_per_share"),
    totalValueUsd: real("total_value_usd"),
    isOpenMarketBuy: integer("is_open_market_buy", {
      mode: "boolean",
    }).notNull(),
    filedAt: text("filed_at").notNull(),
    transactionDate: text("transaction_date").notNull(),
    documentUrl: text("document_url"),
    ingestedAt: text("ingested_at").notNull(),
  },
  (table) => ({
    accessionUnique: uniqueIndex("idx_form4_accession_insider").on(
      table.accessionNumber,
      table.insiderName,
      table.transactionCode,
      table.transactionDate,
    ),
    tickerFiledIdx: index("idx_form4_ticker_filed").on(
      table.ticker,
      table.filedAt,
    ),
  }),
);

/** Nightly operator digest (finish-line 08 T4). */
export const briefings = sqliteTable("briefings", {
  date: text("date").primaryKey(),
  docJson: text("doc_json").notNull(),
  narrative: text("narrative").notNull(),
  createdAt: text("created_at").notNull(),
});

/** Hourly + on-trade-close portfolio equity marks (finish-line 08 T5). */
export const equitySnapshots = sqliteTable(
  "equity_snapshots",
  {
    id: text("id").primaryKey(),
    ts: text("ts").notNull(),
    total: real("total").notNull(),
    perAccountJson: text("per_account_json").notNull().default("{}"),
    perExperienceJson: text("per_experience_json").notNull().default("{}"),
    aiSpendUsd: real("ai_spend_usd").notNull().default(0),
    marksStale: integer("marks_stale", { mode: "boolean" })
      .notNull()
      .default(false),
  },
  (table) => ({
    tsIdx: index("idx_equity_snapshots_ts").on(table.ts),
  }),
);

/**
 * Persisted ghost (paper) positions for venues without native position
 * lookup (Polymarket). Keyed by broker order id so an adapter rebuilt after
 * a restart can rehydrate open/resting positions instead of treating an
 * unknown order id as already closed.
 */
export const paperPositions = sqliteTable(
  "paper_positions",
  {
    brokerOrderId: text("broker_order_id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => brokerAccounts.id, { onDelete: "cascade" }),
    venue: text("venue").notNull(),
    instrumentSymbol: text("instrument_symbol").notNull(),
    side: text("side").notNull(),
    shares: real("shares").notNull(),
    entryPrice: real("entry_price").notNull(),
    sizeUsd: real("size_usd").notNull(),
    open: integer("open", { mode: "boolean" }).notNull().default(true),
    resting: integer("resting", { mode: "boolean" }).notNull().default(false),
    metadataJson: text("metadata_json").notNull().default("{}"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({
    accountOpenIdx: index("idx_paper_positions_account_open").on(
      table.accountId,
      table.open,
    ),
  }),
);
