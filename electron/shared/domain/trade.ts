import type {
  AgentRunFinishReason,
  EventSourceType,
  InstrumentClass,
  LogLevel,
  PredictionOutcome,
  TradeSide,
  TradeStatus,
} from "./enums";

export interface TradeApproval {
  id: string;
  sessionId: string;
  tradeId: string;
  brokerAccountId: string;
  instrumentSymbol: string;
  instrumentDisplayName: string | null;
  predictionOutcome: PredictionOutcome | null;
  instrumentMetadataJson: string | null;
  instrumentClass: InstrumentClass;
  proposedSide: TradeSide;
  proposedSizeUsd: number;
  decisionSummaryJson: string;
  status: "pending" | "approved" | "rejected";
  requestedAt: string;
  resolvedAt: string | null;
  decisionNote: string | null;
}

export interface CapitalReservation {
  id: string;
  sessionId: string;
  approvalId: string | null;
  tradeId: string | null;
  amountUsd: number;
  reason: "approval" | "open_order" | "open_position";
  status: "reserved" | "consumed" | "released";
  createdAt: string;
  releasedAt: string | null;
}

export interface Trade {
  id: string;
  sessionId?: string;
  /** Populated when listing trades for display (global workspace). */
  sessionName?: string;
  brokerAccountId?: string | null;
  instrumentSymbol: string;
  instrumentDisplayName?: string | null;
  predictionOutcome?: PredictionOutcome | null;
  instrumentMetadataJson?: string | null;
  instrumentType: InstrumentClass;
  side: TradeSide;
  entry_price: number | null;
  position_size_usd: number;
  stop_loss_price: number | null;
  take_profit_price: number | null;
  strategy: string;
  /** Deterministic execution strategy from decision phase (e.g. trend_momentum). */
  execution_strategy?: string | null;
  status: TradeStatus;
  opened_at: string | null;
  closed_at: string | null;
  final_pnl_usd: number | null;
  ai_cost_usd: number;
  confidence_score: number | null;
  broker_order_id: string | null;
  high_water_mark_price: number | null;
  low_water_mark_price: number | null;
  exit_reason: string | null;
  client_order_id?: string | null;
  close_market_snapshot_json?: string | null;
  mfe_usd?: number | null;
  mae_usd?: number | null;
  spread_at_entry_bps?: number | null;
  slippage_bps?: number | null;
  created_at: string;
  current_price?: number | null;
  unrealized_pnl?: number | null;
}

export interface AgentRun {
  id: string;
  session_id?: string;
  /** Null for runs not tied to a trade (e.g. instrument selector). */
  trade_id: string | null;
  cycle_id?: string | null;
  agent_type: string;
  model: string;
  provider_key: string;
  finish_reason: AgentRunFinishReason;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  output_text: string;
  duration_ms: number;
  created_at: string;
}

/** External API observability row (`api_call_log`). */
export interface ApiCallLogEntry {
  id: string;
  session_id: string | null;
  trade_id: string | null;
  cycle_id: string | null;
  provider: string;
  endpoint: string;
  call_type: string;
  credits_used: number | null;
  cost_usd: number | null;
  latency_ms: number;
  status: string;
  from_cache: boolean;
  created_at: string;
}

export interface AgentMessage {
  id: string;
  agent_run_id: string;
  session_id: string;
  trade_id: string | null;
  /** Research burst correlation id; null when not part of a burst. */
  cycle_id: string | null;
  role: string;
  provider_key: string;
  model_id: string;
  messages_json: string;
  thinking_json: string | null;
  tool_calls_json: string | null;
  output_json: string | null;
  output_schema_name: string | null;
  parse_fallback: boolean;
  strategy_snapshot_json: string;
  market_snapshot_json: string | null;
  created_at: string;
}

export interface EventRow {
  id: string;
  session_id?: string | null;
  trade_id: string | null;
  cycle_id?: string | null;
  level: LogLevel;
  agent_type: EventSourceType | null;
  message: string;
  created_at: string;
}

export interface TradeDetail {
  trade: Trade;
  runs: AgentRun[];
  messages: AgentMessage[];
}

export interface TradeDecisionPayload {
  trade_id: string;
  approval_id?: string;
  session_id?: string;
  instrumentSymbol: string;
  instrumentDisplayName?: string;
  predictionOutcome?: PredictionOutcome | null;
  instrumentMetadataJson?: string | null;
  side: TradeSide;
  size_usd: number;
  confidence: number;
  reasoning: string;
}

/** Enriched row for approval:list (dashboard). */
export interface ApprovalSummary extends TradeApproval {
  sessionName: string;
  brokerName: string;
  /** Parsed from decisionSummaryJson when present. */
  confidenceScore?: number;
}
