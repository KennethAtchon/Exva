import type {
  AgentRun,
  BrokerAccount,
  BrokerRoutingDefault,
  CapitalReservation,
  EventRow,
  ProviderAccount,
  ExecutionStepState,
  SessionBrokerRoutingOverride,
  SessionTemplate,
  Trade,
  TradeApproval,
  WorkspaceSession,
} from "@/lib/types";
import {
  DEFAULT_MOCK_ACCOUNT_BALANCE_USD,
  DEFAULT_MOCK_EXECUTION_TIER,
  DEFAULT_MOCK_SCENARIO_KIND,
  isMockScenarioKind,
  type MockExecutionTier,
} from "@electron/shared/domain/mock-scenario";

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
    low_water_mark_price: nullableNumber(row.low_water_mark_price),
    exit_reason: nullableString(row.exit_reason),
    client_order_id: nullableString(row.client_order_id),
    close_market_snapshot_json: nullableString(row.close_market_snapshot_json),
    mfe_usd: nullableNumber(row.mfe_usd),
    mae_usd: nullableNumber(row.mae_usd),
    spread_at_entry_bps: nullableNumber(row.spread_at_entry_bps),
    slippage_bps: nullableNumber(row.slippage_bps),
    commission_usd: nullableNumber(row.commission_usd),
    borrow_cost_usd: nullableNumber(row.borrow_cost_usd),
    execution_cost_usd: nullableNumber(row.execution_cost_usd),
    take_profit_touched_at: nullableString(row.take_profit_touched_at),
    stop_touched_at: nullableString(row.stop_touched_at),
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
    outcome: nullableString(row.outcome),
    retryable: Boolean(row.retryable),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
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
    experienceId: String(row.experience_id ?? "edgar-catalyst"),
    createdAt: String(row.created_at),
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
  const isMockBroker = row.broker_type === "mock";
  const balanceCacheUsd = nullableNumber(row.balance_cache_usd);
  return {
    id: String(row.id),
    name: String(row.name),
    brokerType: String(row.broker_type),
    supportedInstrumentClasses: parseJsonArray(
      row.supported_instrument_classes,
    ) as BrokerAccount["supportedInstrumentClasses"],
    mode: row.mode as BrokerAccount["mode"],
    mockScenarioKind:
      row.mock_scenario_kind != null &&
      isMockScenarioKind(String(row.mock_scenario_kind))
        ? (String(row.mock_scenario_kind) as BrokerAccount["mockScenarioKind"])
        : isMockBroker
          ? DEFAULT_MOCK_SCENARIO_KIND
          : null,
    mockExecutionTier:
      row.mock_execution_tier === "rehearsal" ||
      row.mock_execution_tier === "scripted"
        ? (row.mock_execution_tier as MockExecutionTier)
        : isMockBroker
          ? DEFAULT_MOCK_EXECUTION_TIER
          : null,
    maxSessions: Number(row.max_sessions ?? 10),
    allocationEnforcement:
      (row.allocation_enforcement as BrokerAccount["allocationEnforcement"]) ??
      "hard",
    balanceRefreshIntervalMin: Number(row.balance_refresh_interval_min ?? 5),
    balanceCacheUsd:
      balanceCacheUsd ??
      (isMockBroker ? DEFAULT_MOCK_ACCOUNT_BALANCE_USD : null),
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
