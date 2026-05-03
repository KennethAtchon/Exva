import type {
  AgentRun,
  BrokerAccount,
  BrokerRoutingDefault,
  CapitalReservation,
  EventRow,
  ProviderAccount,
  SessionAiRole,
  SessionBrokerRoutingOverride,
  SessionConfig,
  SessionSelectorSettings,
  SessionStrategy,
  SessionTemplate,
  Trade,
  TradeApproval,
  WorkspacePreferences,
  WorkspaceSession,
} from "@/lib/types";
import { isHoldingStyle, isTradingTimeframe } from "@electron/shared/domain";

type Row = Record<string, unknown>;

export function toTrade(row: Row): Trade {
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    brokerAccountId: nullableString(row.broker_account_id),
    instrumentSymbol: String(row.instrument_symbol),
    instrumentType: row.instrument_type as Trade["instrumentType"],
    side: row.side as Trade["side"],
    entry_price: nullableNumber(row.entry_price),
    position_size_usd: Number(row.position_size_usd),
    stop_loss_price: nullableNumber(row.stop_loss_price),
    take_profit_price: nullableNumber(row.take_profit_price),
    strategy: String(row.strategy),
    status: row.status as Trade["status"],
    opened_at: nullableString(row.opened_at),
    closed_at: nullableString(row.closed_at),
    final_pnl_usd: nullableNumber(row.final_pnl_usd),
    ai_cost_usd: Number(row.ai_cost_usd ?? 0),
    confidence_score: nullableNumber(row.confidence_score),
    broker_order_id: nullableString(row.broker_order_id),
    created_at: String(row.created_at),
  };
}

export function toAgentRun(row: Row): AgentRun {
  return {
    id: String(row.id),
    session_id: String(row.session_id),
    trade_id: nullableString(row.trade_id),
    agent_type: row.agent_type as AgentRun["agent_type"],
    model: String(row.model),
    input_tokens: Number(row.input_tokens),
    output_tokens: Number(row.output_tokens),
    cost_usd: Number(row.cost_usd),
    output_text: String(row.output_text),
    duration_ms: Number(row.duration_ms),
    created_at: String(row.created_at),
  };
}

export function toEventRow(row: Row): EventRow {
  return {
    id: String(row.id),
    session_id: nullableString(row.session_id),
    trade_id: nullableString(row.trade_id),
    level: row.level as EventRow["level"],
    agent_type: row.agent_type ? (row.agent_type as EventRow["agent_type"]) : null,
    message: String(row.message),
    created_at: String(row.created_at),
  };
}

export function toSessionConfig(row: Row): SessionConfig {
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
  return {
    id: String(row.id),
    name: String(row.name),
    objective: String(row.objective),
    status: row.status as WorkspaceSession["status"],
    isFocused: Boolean(row.is_focused),
    selectionMode: row.selection_mode as WorkspaceSession["selectionMode"],
    instrumentClasses: parseJsonArray(row.instrument_classes) as WorkspaceSession["instrumentClasses"],
    instrumentScope: String(row.instrument_scope),
    defaultSearchProviderId: nullableString(row.default_search_provider_id),
    capitalLimitUsd: Number(row.capital_limit_usd),
    executionMode: row.execution_mode as WorkspaceSession["executionMode"],
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function toSessionSelectorSettings(row: Row): SessionSelectorSettings {
  return {
    sessionId: String(row.session_id),
    aiPickerEnabled: Boolean(row.ai_picker_enabled),
    updatedAt: String(row.updated_at),
  };
}

export function toSessionStrategy(row: Row): SessionStrategy {
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
    timeframeNotes: row.timeframe_notes != null ? String(row.timeframe_notes) : "",
  };
}

export function toSessionAiRole(row: Row): SessionAiRole {
  return {
    sessionId: String(row.session_id),
    role: row.role as SessionAiRole["role"],
    providerKey: String(row.provider_key),
    modelId: String(row.model_id),
    temperature: Number(row.temperature),
    maxTokens: Number(row.max_tokens),
    webSearchEnabled: Boolean(row.web_search_enabled),
    promptSource: row.prompt_source as SessionAiRole["promptSource"],
    promptMarkdown: String(row.prompt_markdown),
    promptAssetPath: nullableString(row.prompt_asset_path),
  };
}

export function toProviderAccount(row: Row): ProviderAccount {
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
  return {
    id: String(row.id),
    name: String(row.name),
    brokerType: String(row.broker_type),
    supportedInstrumentClasses: parseJsonArray(row.supported_instrument_classes) as BrokerAccount["supportedInstrumentClasses"],
    mode: row.mode as BrokerAccount["mode"],
    secretRef: String(row.secret_ref),
    updatedAt: String(row.updated_at),
  };
}

export function toBrokerRoutingDefault(row: Row): BrokerRoutingDefault {
  return {
    instrumentClass: row.instrument_class as BrokerRoutingDefault["instrumentClass"],
    defaultBrokerAccountId: String(row.default_broker_account_id),
  };
}

export function toSessionBrokerRoutingOverride(row: Row): SessionBrokerRoutingOverride {
  return {
    sessionId: String(row.session_id),
    instrumentClass: row.instrument_class as SessionBrokerRoutingOverride["instrumentClass"],
    brokerAccountId: String(row.broker_account_id),
  };
}

export function toWorkspacePreferences(row: Row): WorkspacePreferences {
  return {
    id: 1,
    globalIncludeArchived: Boolean(row.global_include_archived),
    defaultSearchProviderId: nullableString(row.default_search_provider_id),
    capitalAllocationMode: row.capital_allocation_mode as WorkspacePreferences["capitalAllocationMode"],
    globalCapitalPoolUsd: nullableNumber(row.global_capital_pool_usd),
    updatedAt: String(row.updated_at),
  };
}

export function toSessionTemplate(row: Row): SessionTemplate {
  return {
    id: String(row.id),
    name: String(row.name),
    description: nullableString(row.description),
    sourceSessionId: nullableString(row.source_session_id),
    templatePayloadJson: String(row.template_payload_json),
    instrumentClasses: parseJsonArray(row.instrument_classes) as SessionTemplate["instrumentClasses"],
    updatedAt: String(row.updated_at),
  };
}

export function toTradeApproval(row: Row): TradeApproval {
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    tradeId: String(row.trade_id),
    brokerAccountId: String(row.broker_account_id),
    instrumentSymbol: String(row.instrument_symbol),
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
