import type { AgentMessage, AgentRun } from "@/lib/types";
import type { EngineInputBuilder } from "../../execution/input-builder-registry";
import type { LLMRunResult } from "../../../llm/llm-types";
import type { TradeSignal } from "@electron/shared/ai/trade-signals";
import {
  aggregateCatalystTradeSignal,
  catalystAnalystOutputSchema,
  type CatalystAnalystOutput,
} from "../../../signals/aggregators/catalyst-two-call-aggregator";
import { safeJsonParse } from "../../../infra/safe-json-parse";

function syntheticDecisionRun(
  sessionId: string,
  signal: TradeSignal,
): LLMRunResult<TradeSignal> {
  const runId = crypto.randomUUID();
  const run: AgentRun = {
    id: runId,
    session_id: sessionId,
    trade_id: null,
    cycle_id: null,
    agent_type: "decision",
    model: "deterministic",
    provider_key: "catalyst-two-call",
    finish_reason: "stop",
    input_tokens: 0,
    output_tokens: 0,
    cost_usd: 0,
    output_text: signal.reasoning,
    duration_ms: 0,
    created_at: new Date().toISOString(),
  };
  const message: AgentMessage = {
    id: crypto.randomUUID(),
    agent_run_id: runId,
    session_id: sessionId,
    trade_id: null,
    cycle_id: null,
    role: "decision",
    provider_key: "catalyst-two-call",
    model_id: "deterministic",
    messages_json: "[]",
    thinking_json: null,
    tool_calls_json: "[]",
    output_json: JSON.stringify(signal),
    output_schema_name: "catalyst-trade-decision",
    parse_fallback: false,
    strategy_snapshot_json: "{}",
    market_snapshot_json: null,
    created_at: new Date().toISOString(),
  };
  return { run, message, output: signal };
}

function parseAnalystFromFundamental(
  rawSummary: string,
): CatalystAnalystOutput {
  const parsed = safeJsonParse<Record<string, unknown>>(rawSummary);
  if (!parsed || parsed.kind !== "catalyst-analyst") {
    throw new Error(
      "Expected catalyst-analyst payload in fundamental rawSummary.",
    );
  }
  return catalystAnalystOutputSchema.parse(parsed);
}

export const catalystTradeDecisionInputBuilder: EngineInputBuilder = {
  id: "catalyst-trade-decision-input",
  async build({ planCtx: ctx, state }) {
    const fundamental = state.fundamental?.output;
    const review = state.review?.output;
    if (!fundamental || !review) {
      throw new Error(
        "Catalyst decision requires fundamental and review outputs.",
      );
    }
    const analyst = parseAnalystFromFundamental(fundamental.rawSummary);
    const signal = aggregateCatalystTradeSignal(
      ctx.instrument.symbol,
      analyst,
      review,
      {
        waitForOpenThreshold:
          ctx.strategyContext.riskConfig.waitForOpenThreshold,
      },
    );
    return {
      task: { signal },
      statePatch: {
        decision: syntheticDecisionRun(ctx.sessionId, signal),
      },
    };
  },
};

export const CATALYST_DECISION_INPUT_BUILDERS = [
  catalystTradeDecisionInputBuilder,
];
