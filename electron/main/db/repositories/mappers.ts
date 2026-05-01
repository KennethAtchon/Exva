import type {
  AgentRun,
  EventRow,
  SessionConfig,
  SessionStatus,
  Trade,
  WorkspaceSession,
} from "@/lib/types";

type TradeRow = Record<string, unknown>;

export function toTrade(row: TradeRow): Trade {
  return {
    id: String(row.id),
    session_id: String(row.session_id),
    asset: String(row.asset),
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

export function toAgentRun(row: Record<string, unknown>): AgentRun {
  return {
    id: String(row.id),
    session_id: String(row.session_id),
    trade_id: String(row.trade_id),
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

export function toEventRow(row: Record<string, unknown>): EventRow {
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

export function toSessionConfig(row: Record<string, unknown>): SessionConfig {
  return {
    strategy: String(row.strategy),
    max_position_usd: Number(row.max_position_usd),
    stop_loss_pct: Number(row.stop_loss_pct),
    take_profit_pct: Number(row.take_profit_pct),
    max_concurrent_trades: Number(row.max_concurrent_trades),
    research_depth: row.research_depth as SessionConfig["research_depth"],
    daily_loss_limit_usd: Number(row.daily_loss_limit_usd),
    profit_target_usd: Number(row.profit_target_usd),
    max_api_spend_usd: Number(row.max_api_spend_usd),
    human_approval_required: Boolean(row.human_approval_required),
  };
}

export function toWorkspaceSession(row: Record<string, unknown>): WorkspaceSession {
  return {
    id: String(row.id),
    name: String(row.name),
    objective: String(row.objective),
    status: row.status as WorkspaceSession["status"],
    isFocused: Boolean(row.is_focused),
    selectionMode: row.selection_mode as WorkspaceSession["selectionMode"],
    instrumentClasses: parseInstrumentClasses(row.instrument_classes),
    instrumentScope: String(row.instrument_scope),
    defaultSearchProviderId: nullableString(row.default_search_provider_id),
    capitalLimitUsd: Number(row.capital_limit_usd),
    executionMode: row.execution_mode as WorkspaceSession["executionMode"],
    startedAt: nullableString(row.started_at),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function toSessionStatus(row: Record<string, unknown> | undefined): SessionStatus {
  return (row?.status as SessionStatus | undefined) ?? "idle";
}

function parseInstrumentClasses(value: unknown): WorkspaceSession["instrumentClasses"] {
  if (typeof value !== "string") return ["stock"];
  try {
    const parsed = JSON.parse(value) as unknown[];
    return parsed.filter((entry): entry is WorkspaceSession["instrumentClasses"][number] => typeof entry === "string");
  } catch {
    return ["stock"];
  }
}

function nullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function nullableNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}
