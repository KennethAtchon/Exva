import type { AgentMessage, AgentRun } from "@/lib/types";
import type { EngineInputBuilder } from "../../execution/input-builder-registry";
import type { LLMRunResult } from "../../../llm/llm-types";
import type { TradeSignal } from "@electron/shared/ai/trade-signals";

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
    output_schema_name: "rules-trend-following",
    parse_fallback: false,
    strategy_snapshot_json: "{}",
    market_snapshot_json: null,
    created_at: new Date().toISOString(),
  };
  return { run, message, output: signal };
}

function resolveCadence(metadataJson: string | null | undefined): string {
  if (!metadataJson) return "4h";
  try {
    const meta = JSON.parse(metadataJson) as { cadence?: string };
    return meta.cadence ?? "4h";
  } catch {
    return "4h";
  }
}

function timeframeForCadence(
  cadence: string,
): "15m" | "30m" | "1h" | "4h" | "1d" {
  if (cadence === "15m") return "15m";
  if (cadence === "30m") return "30m";
  if (cadence === "1h") return "1h";
  if (cadence === "4h") return "4h";
  return "1d";
}

export const rulesTrendFollowingInputBuilder: EngineInputBuilder = {
  id: "rules-trend-following-input",
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
    const cadence = resolveCadence(ctx.instrument.instrumentMetadataJson);
    const timeframe = timeframeForCadence(cadence);
    const barCount = timeframe === "4h" ? 40 : 30;
    const bars = adapter.getOhlcv
      ? await adapter.getOhlcv(wireSymbol, timeframe, barCount)
      : [];
    return {
      task: {
        symbol: ctx.instrument.symbol,
        ohlcv: bars.map((bar) => ({ close: bar.close })),
        lookback: 20,
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

export const RULES_TREND_FOLLOWING_INPUT_BUILDERS = [
  rulesTrendFollowingInputBuilder,
];
