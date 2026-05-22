import type {
  AgentRun,
  BrokerAccount,
  BrokerRoutingDefault,
  CapitalReservation,
  EventRow,
  ProviderAccount,
  ExecutionStepState,
  SessionRiskConfig,
  SessionBrokerRoutingOverride,
  SessionConfig,
  SessionSelectorSettings,
  SessionStrategy,
  SessionTradeRules,
  SessionResearchPosture,
  SessionTimeframeConfig,
  SessionTemplate,
  Trade,
  TradeApproval,
  WorkspacePreferences,
  WorkspaceSession,
} from "@/lib/types";
import { isHoldingStyle, isTradingTimeframe } from "@electron/shared/domain";

type Row = Record<string, unknown>;

export function toTrade(row: Row): Trade {
  row = normalizeRow(row);
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    brokerAccountId: nullableString(row.broker_account_id),
    instrumentSymbol: String(row.instrument_symbol),
    instrumentDisplayName: nullableString(row.instrument_display_name),
    predictionOutcome: nullableString(
      row.prediction_outcome,
    ) as Trade["predictionOutcome"],
    instrumentMetadataJson: nullableString(row.instrument_metadata_json),
    instrumentType: row.instrument_type as Trade["instrumentType"],
    side: row.side as Trade["side"],
    entry_price: nullableNumber(row.entry_price),
    position_size_usd: Number(row.position_size_usd),
    stop_loss_price: nullableNumber(row.stop_loss_price),
    take_profit_price: nullableNumber(row.take_profit_price),
    strategy: String(row.strategy),
    execution_strategy: nullableString(row.execution_strategy),
    status: row.status as Trade["status"],
    opened_at: nullableString(row.opened_at),
    closed_at: nullableString(row.closed_at),
    final_pnl_usd: nullableNumber(row.final_pnl_usd),
    ai_cost_usd: Number(row.ai_cost_usd ?? 0),
    confidence_score: nullableNumber(row.confidence_score),
    broker_order_id: nullableString(row.broker_order_id),
    high_water_mark_price: nullableNumber(row.high_water_mark_price),
    exit_reason: nullableString(row.exit_reason),
    client_order_id: nullableString(row.client_order_id),
    close_market_snapshot_json: nullableString(row.close_market_snapshot_json),
    created_at: String(row.created_at),
  };
}

export function toAgentRun(row: Row): AgentRun {
  row = normalizeRow(row);
  return {
    id: String(row.id),
    session_id: String(row.session_id),
    trade_id: nullableString(row.trade_id),
    cycle_id: nullableString(row.cycle_id),
    agent_type: row.agent_type as AgentRun["agent_type"],
    model: String(row.model),
    provider_key:
      row.provider_key != null ? String(row.provider_key) : "unknown",
    finish_reason: (row.finish_reason as AgentRun["finish_reason"]) ?? "stop",
    input_tokens: Number(row.input_tokens),
    output_tokens: Number(row.output_tokens),
    cost_usd: Number(row.cost_usd),
    output_text: String(row.output_text),
    duration_ms: Number(row.duration_ms),
    created_at: String(row.created_at),
  };
}

export function toEventRow(row: Row): EventRow {
  row = normalizeRow(row);
  return {
    id: String(row.id),
    session_id: nullableString(row.session_id),
    trade_id: nullableString(row.trade_id),
    cycle_id: nullableString(row.cycle_id),
    level: row.level as EventRow["level"],
    agent_type: row.agent_type
      ? (row.agent_type as EventRow["agent_type"])
      : null,
    message: String(row.message),
    created_at: String(row.created_at),
  };
}

export function toExecutionStepState(row: Row): ExecutionStepState {
  row = normalizeRow(row);
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    cycleId: String(row.cycle_id),
    stage: row.stage as ExecutionStepState["stage"],
    status: row.status as ExecutionStepState["status"],
    attempt: Number(row.attempt),
    startedAt: nullableString(row.started_at),
    completedAt: nullableString(row.completed_at),
    nextRetryAt: nullableString(row.next_retry_at),
    lastErrorCode: nullableString(row.last_error_code),
    lastErrorMessage: nullableString(row.last_error_message),
    retryable: Boolean(row.retryable),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function toSessionConfig(row: Row): SessionConfig {
  row = normalizeRow(row);
  return {
    strategy: String(row.strategy_profile),
    max_position_usd: Number(row.max_position_usd),
    stop_loss_pct: Number(row.stop_loss_pct),
    take_profit_pct: Number(row.take_profit_pct),
    max_concurrent_trades: Number(row.max_concurrent_trades),
    research_depth: row.research_depth as SessionConfig["research_depth"],
    daily_loss_limit_usd: Number(row.daily_loss_limit_usd),
    profit_target_usd: Number(row.profit_target_usd),
    max_api_spend_usd: Number(row.max_ai_spend_usd),
    human_approval_required: Boolean(row.human_approval_required),
  };
}

export function toWorkspaceSession(row: Row): WorkspaceSession {
  row = normalizeRow(row);
  return {
    id: String(row.id),
    name: String(row.name),
    objective: String(row.objective),
    status: row.status as WorkspaceSession["status"],
    isFocused: Boolean(row.is_focused),
    selectionMode: row.selection_mode as WorkspaceSession["selectionMode"],
    instrumentClasses: parseJsonArray(
      row.instrument_classes,
    ) as WorkspaceSession["instrumentClasses"],
    instrumentScope: String(row.instrument_scope),
    defaultSearchProviderId: nullableString(row.default_search_provider_id),
    executionMode: row.execution_mode as WorkspaceSession["executionMode"],
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function toSessionSelectorSettings(row: Row): SessionSelectorSettings {
  row = normalizeRow(row);
  return {
    sessionId: String(row.session_id),
    aiPickerEnabled: Boolean(row.ai_picker_enabled),
    noInstrumentRetryMinutes:
      row.no_instrument_retry_minutes != null
        ? Number(row.no_instrument_retry_minutes)
        : null,
    updatedAt: String(row.updated_at),
  };
}

export function toSessionStrategy(row: Row): SessionStrategy {
  row = normalizeRow(row);
  const primaryTf = row.primary_trading_timeframe;
  const holdStyle = row.holding_style;
  return {
    sessionId: String(row.session_id),
    strategyProfile: row.strategy_profile as SessionStrategy["strategyProfile"],
    maxPositionUsd: Number(row.max_position_usd),
    stopLossPct: Number(row.stop_loss_pct),
    takeProfitPct: Number(row.take_profit_pct),
    maxConcurrentTrades: Number(row.max_concurrent_trades),
    researchDepth: row.research_depth as SessionStrategy["researchDepth"],
    dailyLossLimitUsd: Number(row.daily_loss_limit_usd),
    profitTargetUsd: Number(row.profit_target_usd),
    maxAiSpendUsd: Number(row.max_ai_spend_usd),
    humanApprovalRequired: Boolean(row.human_approval_required),
    primaryTradingTimeframe: isTradingTimeframe(primaryTf) ? primaryTf : "1d",
    holdingStyle: isHoldingStyle(holdStyle) ? holdStyle : "multi_day_swing",
    targetHoldDays: nullableNumber(row.target_hold_days),
    maxHoldDays: nullableNumber(row.max_hold_days),
    timeframeNotes:
      row.timeframe_notes != null ? String(row.timeframe_notes) : "",
  };
}

export function toSessionResearchPosture(row: Row): SessionResearchPosture {
  row = normalizeRow(row);
  return {
    sessionId: String(row.session_id),
    posturePresetId:
      row.posture_preset_id as SessionResearchPosture["posturePresetId"],
    discoveryMode:
      row.discovery_mode as SessionResearchPosture["discoveryMode"],
    evidenceMode: row.evidence_mode as SessionResearchPosture["evidenceMode"],
    catalystMode: row.catalyst_mode as SessionResearchPosture["catalystMode"],
    fundamentalStrictness:
      row.fundamental_strictness as SessionResearchPosture["fundamentalStrictness"],
    postureNotes: row.posture_notes != null ? String(row.posture_notes) : "",
    updatedAt: String(row.updated_at),
  };
}

export function toSessionTradeRules(row: Row): SessionTradeRules {
  row = normalizeRow(row);
  return {
    sessionId: String(row.session_id),
    rulesPresetId: row.rules_preset_id as SessionTradeRules["rulesPresetId"],
    setupType: row.setup_type as SessionTradeRules["setupType"],
    sideBias: row.side_bias as SessionTradeRules["sideBias"],
    entryStyle: row.entry_style as SessionTradeRules["entryStyle"],
    exitStyle: row.exit_style as SessionTradeRules["exitStyle"],
    scalingMode: row.scaling_mode as SessionTradeRules["scalingMode"],
    tradeRulesMarkdown:
      row.trade_rules_markdown != null ? String(row.trade_rules_markdown) : "",
    ruleNotes: row.rule_notes != null ? String(row.rule_notes) : "",
    updatedAt: String(row.updated_at),
  };
}

export function toSessionRiskConfig(row: Row): SessionRiskConfig {
  row = normalizeRow(row);
  return {
    sessionId: String(row.session_id),
    riskPresetId:
      (row.risk_preset_id as SessionRiskConfig["riskPresetId"]) ?? "custom",
    maxPositionUsd: Number(row.max_position_usd),
    stopLossPct: nullableNumber(row.stop_loss_pct),
    takeProfitPct: nullableNumber(row.take_profit_pct),
    stopLossType: row.stop_loss_type as SessionRiskConfig["stopLossType"],
    atrStopMultiplier: nullableNumber(row.atr_stop_multiplier),
    kellyFraction: Number(row.kelly_fraction),
    predictionEdgeThreshold: Number(row.prediction_edge_threshold),
    maxExposureUsd: nullableNumber(row.max_exposure_usd),
    waitForOpenThreshold: Number(row.wait_for_open_threshold),
    maxConcurrentTrades: Number(row.max_concurrent_trades),
    dailyLossLimitUsd: Number(row.daily_loss_limit_usd),
    profitTargetUsd: Number(row.profit_target_usd),
    maxAiSpendUsd: Number(row.max_ai_spend_usd),
    maxDataSpendUsd:
      row.max_data_spend_usd != null ? Number(row.max_data_spend_usd) : 5,
    humanApprovalRequired: Boolean(row.human_approval_required),
    updatedAt: String(row.updated_at),
  };
}

export function toSessionTimeframeConfig(row: Row): SessionTimeframeConfig {
  row = normalizeRow(row);
  const primaryTf = row.primary_trading_timeframe;
  const holdStyle = row.holding_style;
  return {
    sessionId: String(row.session_id),
    timeframePresetId:
      (row.timeframe_preset_id as SessionTimeframeConfig["timeframePresetId"]) ??
      "custom",
    primaryTradingTimeframe: isTradingTimeframe(primaryTf) ? primaryTf : "1d",
    holdingStyle: isHoldingStyle(holdStyle) ? holdStyle : "multi_day_swing",
    targetHoldDays: nullableNumber(row.target_hold_days),
    maxHoldDays: nullableNumber(row.max_hold_days),
    timeframeNotes:
      row.timeframe_notes != null ? String(row.timeframe_notes) : "",
    updatedAt: String(row.updated_at),
  };
}

export function toProviderAccount(row: Row): ProviderAccount {
  row = normalizeRow(row);
  return {
    id: String(row.id),
    name: String(row.name),
    category: row.category as ProviderAccount["category"],
    providerType: row.provider_type as ProviderAccount["providerType"],
    secretRef: String(row.secret_ref),
    metadataJson: nullableString(row.metadata_json),
    isConfigured: Boolean(row.is_configured),
    lastTestStatus: row.last_test_status as ProviderAccount["lastTestStatus"],
    updatedAt: String(row.updated_at),
  };
}

export function toBrokerAccount(row: Row): BrokerAccount {
  row = normalizeRow(row);
  return {
    id: String(row.id),
    name: String(row.name),
    brokerType: String(row.broker_type),
    supportedInstrumentClasses: parseJsonArray(
      row.supported_instrument_classes,
    ) as BrokerAccount["supportedInstrumentClasses"],
    mode: row.mode as BrokerAccount["mode"],
    maxSessions: Number(row.max_sessions ?? 10),
    allocationEnforcement:
      (row.allocation_enforcement as BrokerAccount["allocationEnforcement"]) ??
      "hard",
    balanceRefreshIntervalMin: Number(row.balance_refresh_interval_min ?? 5),
    balanceCacheUsd: nullableNumber(row.balance_cache_usd),
    balanceCachedAt: nullableString(row.balance_cached_at),
    secretRef: String(row.secret_ref),
    updatedAt: String(row.updated_at),
  };
}

export function toBrokerRoutingDefault(row: Row): BrokerRoutingDefault {
  row = normalizeRow(row);
  return {
    instrumentClass:
      row.instrument_class as BrokerRoutingDefault["instrumentClass"],
    defaultBrokerAccountId: String(row.default_broker_account_id),
  };
}

export function toSessionBrokerRoutingOverride(
  row: Row,
): SessionBrokerRoutingOverride {
  row = normalizeRow(row);
  return {
    sessionId: String(row.session_id),
    instrumentClass:
      row.instrument_class as SessionBrokerRoutingOverride["instrumentClass"],
    brokerAccountId: String(row.broker_account_id),
  };
}

export function toWorkspacePreferences(row: Row): WorkspacePreferences {
  row = normalizeRow(row);
  return {
    id: 1,
    globalIncludeArchived: Boolean(row.global_include_archived),
    globalEnvironmentMode:
      row.global_environment_mode === "live" ? "live" : "paper",
    defaultSearchProviderId: nullableString(row.default_search_provider_id),
    allocationEnforcementOverride:
      (nullableString(
        row.allocation_enforcement_override,
      ) as WorkspacePreferences["allocationEnforcementOverride"]) ?? null,
    defaultModelProviderKey:
      row.default_model_provider_key != null
        ? String(row.default_model_provider_key)
        : "",
    defaultModelModelId:
      row.default_model_model_id != null
        ? String(row.default_model_model_id)
        : "",
    updatedAt: String(row.updated_at),
  };
}

export function toSessionTemplate(row: Row): SessionTemplate {
  row = normalizeRow(row);
  return {
    id: String(row.id),
    name: String(row.name),
    description: nullableString(row.description),
    sourceSessionId: nullableString(row.source_session_id),
    templatePayloadJson: String(row.template_payload_json),
    instrumentClasses: parseJsonArray(
      row.instrument_classes,
    ) as SessionTemplate["instrumentClasses"],
    updatedAt: String(row.updated_at),
  };
}

export function toTradeApproval(row: Row): TradeApproval {
  row = normalizeRow(row);
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    tradeId: String(row.trade_id),
    brokerAccountId: String(row.broker_account_id),
    instrumentSymbol: String(row.instrument_symbol),
    instrumentDisplayName: nullableString(row.instrument_display_name),
    predictionOutcome: nullableString(
      row.prediction_outcome,
    ) as TradeApproval["predictionOutcome"],
    instrumentMetadataJson: nullableString(row.instrument_metadata_json),
    instrumentClass: row.instrument_class as TradeApproval["instrumentClass"],
    proposedSide: row.proposed_side as TradeApproval["proposedSide"],
    proposedSizeUsd: Number(row.proposed_size_usd),
    decisionSummaryJson: String(row.decision_summary_json),
    status: row.status as TradeApproval["status"],
    requestedAt: String(row.requested_at),
    resolvedAt: nullableString(row.resolved_at),
    decisionNote: nullableString(row.decision_note),
  };
}

export function toCapitalReservation(row: Row): CapitalReservation {
  row = normalizeRow(row);
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    approvalId: nullableString(row.approval_id),
    tradeId: nullableString(row.trade_id),
    amountUsd: Number(row.amount_usd),
    reason: row.reason as CapitalReservation["reason"],
    status: row.status as CapitalReservation["status"],
    createdAt: String(row.created_at),
    releasedAt: nullableString(row.released_at),
  };
}

function parseJsonArray(value: unknown): string[] {
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value) as unknown[];
    return parsed.filter((entry): entry is string => typeof entry === "string");
  } catch {
    return [];
  }
}

function nullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function nullableNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

function normalizeRow(row: Row): Row {
  const normalized: Row = { ...row };
  for (const [key, value] of Object.entries(row)) {
    const snakeKey = key.replace(/[A-Z]/g, (char) => `_${char.toLowerCase()}`);
    if (!(snakeKey in normalized)) {
      normalized[snakeKey] = value;
    }
  }
  return normalized;
}
