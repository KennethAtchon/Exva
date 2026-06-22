import type { AgentMessage, AgentRun } from "@/lib/types";
import type { EngineInputBuilder } from "../../execution/input-builder-registry";
import type { LLMRunResult } from "../../../llm/llm-types";
import type { TradeSignal } from "@electron/shared/ai/trade-signals";
import { resolveRulesOhlcvRequest } from "./rules-ohlcv-timeframe";

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
    session_id: sessionId,
    trade_id: null,
    cycle_id: null,
    role: "decision",
    provider_key: "rules",
    model_id: "deterministic",
    messages_json: "[]",
    thinking_json: null,
    tool_calls_json: "[]",
    output_json: JSON.stringify(signal),
    output_schema_name: "rules-mean-reversion",
    parse_fallback: false,
    strategy_snapshot_json: "{}",
    market_snapshot_json: null,
    created_at: new Date().toISOString(),
  };
  return { run, message, output: signal };
}

export const rulesMeanReversionInputBuilder: EngineInputBuilder = {
  id: "rules-mean-reversion-input",
  async build({ planCtx: ctx }) {
    const { adapter } = await ctx.services.brokerRouting.resolveAdapter(
      ctx.sessionId,
      ctx.instrument.instrumentClass,
    );
    const wireSymbol = ctx.services.instrumentNormalizer.toBrokerSymbol({
      symbol: ctx.instrument.symbol,
      instrumentClass: ctx.instrument.instrumentClass,
      brokerType: adapter.brokerType,
    });
    const getOhlcv = adapter.getOhlcv?.bind(adapter);
    const { timeframe, barCount } = resolveRulesOhlcvRequest(
      ctx.instrument.instrumentMetadataJson,
    );
    const bars = getOhlcv
      ? await getOhlcv(wireSymbol, timeframe, barCount)
      : [];
    return {
      task: {
        symbol: ctx.instrument.symbol,
        ohlcv: bars.map((bar) => ({ close: bar.close })),
        zScoreEntry: -2,
      },
    };
  },
  applyOutput(state, output) {
    const signal = output as TradeSignal;
    return {
      ...state,
      decision: syntheticDecisionRun("", signal),
    };
  },
};

export const RULES_ENGINE_INPUT_BUILDERS = [rulesMeanReversionInputBuilder];
