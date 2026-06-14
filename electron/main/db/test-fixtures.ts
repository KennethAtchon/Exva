import type { AgentRun, Trade } from "@/lib/types";
import { AgentRunsRepo } from "./repositories/agents/agent-runs-repo";
import { BrokerAccountsRepo } from "./repositories/brokers/broker-accounts-repo";
import type { CreateSessionInput } from "./repositories/sessions/session-repo";
import { SessionRepo } from "./repositories/sessions/session-repo";
import { TradesRepo } from "./repositories/trades/trades-repo";
import type { DbClient } from "./client";

export function createMinimalSession(
  db: DbClient,
  overrides?: Partial<CreateSessionInput>,
) {
  return new SessionRepo(db).create({
    name: "Test Session",
    objective: "Test objective",
    selectionMode: "manual_shortlist",
    instrumentClasses: ["stock"],
    instrumentScope: "Test scope",
    executionMode: "paper_only",
    ...overrides,
  });
}

export function insertBrokerAccount(
  db: DbClient,
  partial: Partial<Parameters<BrokerAccountsRepo["insert"]>[0]> & {
    id: string;
  },
) {
  const repo = new BrokerAccountsRepo(db);
  return repo.insert({
    name: "Mock Paper",
    brokerType: "mock",
    supportedInstrumentClasses: ["stock"],
    mode: "paper",
    secretRef: `secret:${partial.id}`,
    ...partial,
    id: partial.id,
  });
}

export function insertTrade(
  db: DbClient,
  partial: Partial<Trade> & { id: string; sessionId: string },
): Trade {
  const now = new Date().toISOString();
  const trade: Trade = {
    brokerAccountId: partial.brokerAccountId ?? null,
    instrumentSymbol: partial.instrumentSymbol ?? "AAPL",
    instrumentDisplayName: partial.instrumentDisplayName ?? null,
    predictionOutcome: partial.predictionOutcome ?? null,
    instrumentMetadataJson: partial.instrumentMetadataJson ?? null,
    instrumentType: partial.instrumentType ?? "stock",
    side: partial.side ?? "BUY",
    entry_price: partial.entry_price ?? null,
    position_size_usd: partial.position_size_usd ?? 500,
    stop_loss_price: partial.stop_loss_price ?? null,
    take_profit_price: partial.take_profit_price ?? null,
    strategy: partial.strategy ?? "passive_income",
    status: partial.status ?? "pending",
    opened_at: partial.opened_at ?? null,
    closed_at: partial.closed_at ?? null,
    final_pnl_usd: partial.final_pnl_usd ?? null,
    ai_cost_usd: partial.ai_cost_usd ?? 0,
    confidence_score: partial.confidence_score ?? 0.7,
    broker_order_id: partial.broker_order_id ?? null,
    high_water_mark_price: partial.high_water_mark_price ?? null,
    low_water_mark_price: partial.low_water_mark_price ?? null,
    exit_reason: partial.exit_reason ?? null,
    created_at: partial.created_at ?? now,
    id: partial.id,
    sessionId: partial.sessionId,
  };
  new TradesRepo(db).insert(trade);
  return trade;
}

export function insertAgentRun(
  db: DbClient,
  partial: Partial<AgentRun> & { id: string; session_id: string },
): AgentRun {
  const now = new Date().toISOString();
  const run: AgentRun = {
    trade_id: partial.trade_id ?? null,
    cycle_id: partial.cycle_id ?? null,
    agent_type: partial.agent_type ?? "selector",
    model: partial.model ?? "openai/gpt-4o-mini",
    provider_key: partial.provider_key ?? "provider-openrouter",
    finish_reason: partial.finish_reason ?? "stop",
    input_tokens: partial.input_tokens ?? 1000,
    output_tokens: partial.output_tokens ?? 250,
    cost_usd: partial.cost_usd ?? 0.5,
    output_text: partial.output_text ?? "done",
    duration_ms: partial.duration_ms ?? 1000,
    created_at: partial.created_at ?? now,
    id: partial.id,
    session_id: partial.session_id,
  };
  new AgentRunsRepo(db).insert(run);
  return run;
}
