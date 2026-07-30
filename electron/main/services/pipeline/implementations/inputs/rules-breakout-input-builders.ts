import type { AgentMessage, AgentRun } from "@/lib/types";
import type {
  EngineInputBuilder,
  EngineRunCtx,
} from "../../execution/input-builder-registry";
import type { LLMRunResult } from "../../../llm/llm-types";
import type { TradeSignal } from "@electron/shared/ai/trade-signals";
import { edgeEstimateFromStrength } from "@electron/shared/quant/decision-gate";
import { resolveRulesOhlcvRequest } from "./rules-ohlcv-timeframe";
import {
  readDeterministicFactFromCtx,
  tradeSignalFromDeterministicFact,
} from "./deterministic-fact-consume";

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
    output_schema_name: "rules-breakout",
    parse_fallback: false,
    strategy_snapshot_json: "{}",
    market_snapshot_json: null,
    created_at: new Date().toISOString(),
  };
  return { run, message, output: signal };
}

export const rulesBreakoutInputBuilder: EngineInputBuilder = {
  id: "rules-breakout-input",
  async build({ planCtx: ctx }) {
    const fact = readDeterministicFactFromCtx(ctx);
    if (fact) {
      return { task: tradeSignalFromDeterministicFact(fact, "breakout") };
    }

    const { adapter } = await ctx.services.brokerRouting.resolveAdapter(
      ctx.sessionId,
      ctx.instrument.instrumentClass,
    );
    const wireSymbol = ctx.services.instrumentNormalizer.toBrokerSymbol({
      symbol: ctx.instrument.symbol,
      instrumentClass: ctx.instrument.instrumentClass,
      brokerType: adapter.brokerType,
    });
    const { timeframe, barCount } = resolveRulesOhlcvRequest(
      ctx.instrument.instrumentMetadataJson,
    );
    const bars = adapter.getOhlcv
      ? await adapter.getOhlcv(wireSymbol, timeframe, barCount)
      : [];
    return {
      task: {
        symbol: ctx.instrument.symbol,
        ohlcv: bars.map((bar) => ({
          high: bar.high,
          low: bar.low,
          close: bar.close,
          volume: bar.volume,
        })),
        lookback: 20,
        volumeMultiplierThreshold: 1.5,
      },
    };
  },
  applyOutput(state, output, ctx?: EngineRunCtx) {
    const signal = output as TradeSignal;
    if (ctx) {
      try {
        const p = signal.strength ?? signal.confidence;
        const strength = Math.max(0, p) * 4;
        ctx.services.decisionTracesRepo.upsertFragment(
          {
            cycleId: ctx.cycleId,
            sessionId: ctx.sessionId,
            instrumentSymbol: ctx.instrument.symbol,
          },
          {
            edgeEstimate: edgeEstimateFromStrength({
              modelId: "rules:breakout",
              modelVersion: "rules-1",
              asOf: new Date().toISOString(),
              targetHorizon: "1d",
              strength,
              expectedGrossReturnBps: p * 100,
              expectedCostBps: 15,
              sampleSize: 0,
              predictedProbability: p,
            }),
            aggregation: {
              classifierConfidence: p,
              classifierAction: signal.action,
              waitForOpenThreshold: null,
              belowThreshold: false,
              timerTiming: null,
              timerBlocked: false,
              reviewRecommendation: null,
              finalAction: signal.action,
              skipReason: signal.action === "skip" ? signal.reasoning : null,
            },
          },
        );
      } catch {
        // observability-only
      }
    }
    return {
      ...state,
      decision: syntheticDecisionRun(signal),
    };
  },
};

export const RULES_BREAKOUT_INPUT_BUILDERS = [rulesBreakoutInputBuilder];
