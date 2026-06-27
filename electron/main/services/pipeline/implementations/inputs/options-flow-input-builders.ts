import type { AgentMessage, AgentRun } from "@/lib/types";
import type { EngineInputBuilder } from "../../execution/input-builder-registry";
import type { LLMRunResult } from "../../../llm/llm-types";
import type { TradeSignal } from "@electron/shared/ai/trade-signals";
import { createLogger } from "../../../infra/log";

const logger = createLogger("options-flow-input");

function syntheticDecisionRun(signal: TradeSignal): LLMRunResult<TradeSignal> {
  const runId = crypto.randomUUID();
  const run: AgentRun = {
    id: runId,
    session_id: "",
    trade_id: null,
    cycle_id: null,
    agent_type: "decision",
    model: "deterministic",
    provider_key: "rules",
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
    session_id: "",
    trade_id: null,
    cycle_id: null,
    role: "decision",
    provider_key: "rules",
    model_id: "deterministic",
    messages_json: "[]",
    thinking_json: null,
    tool_calls_json: "[]",
    output_json: JSON.stringify(signal),
    output_schema_name: "options-flow",
    parse_fallback: false,
    strategy_snapshot_json: "{}",
    market_snapshot_json: null,
    created_at: new Date().toISOString(),
  };
  return { run, message, output: signal };
}

/**
 * Assembles the deterministic UOA detector input from the underlying's option
 * chain. v1 trades the underlying instrument on the aggregated flow read;
 * contract-level (defined-risk) execution via `selectOptionContract` is the
 * next phase. When the chain feed returns nothing, the detector skips with a
 * clear "no option volume" reason rather than fabricating a signal.
 */
export const optionsFlowInputBuilder: EngineInputBuilder = {
  id: "options-flow-input",
  async build({ planCtx: ctx }) {
    const { adapter } = await ctx.services.brokerRouting.resolveAdapter(
      ctx.sessionId,
      ctx.instrument.instrumentClass,
    );
    const underlying = ctx.instrument.symbol;
    const getOptionChain = adapter.getOptionChain?.bind(adapter);
    const chain = getOptionChain ? await getOptionChain(underlying) : [];

    if (chain.length === 0) {
      logger.warn(
        {
          sessionId: ctx.sessionId,
          cycleId: ctx.cycleId,
          symbol: underlying,
          brokerType: adapter.brokerType,
        },
        "options-flow received an empty option chain; cycle will skip. Check the options data feed/entitlement.",
      );
    }

    let callVolume = 0;
    let putVolume = 0;
    let callOpenInterest = 0;
    let putOpenInterest = 0;
    for (const c of chain) {
      if (c.type === "call") {
        callVolume += c.dayVolume;
        callOpenInterest += c.openInterest;
      } else {
        putVolume += c.dayVolume;
        putOpenInterest += c.openInterest;
      }
    }

    return {
      task: {
        underlyingSymbol: underlying,
        callVolume,
        putVolume,
        callOpenInterest,
        putOpenInterest,
        ivPercentile: null,
        volumeOiRatioThreshold: 2,
        bullishSkewThreshold: 0.6,
      },
    };
  },
  applyOutput(state, output) {
    const signal = output as TradeSignal;
    return {
      ...state,
      decision: syntheticDecisionRun(signal),
    };
  },
};

export const OPTIONS_FLOW_INPUT_BUILDERS = [optionsFlowInputBuilder];
