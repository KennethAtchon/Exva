import type { AgentMessage, AgentRun } from "@/lib/types";
import type {
  EngineInputBuilder,
  EngineRunCtx,
} from "../../execution/input-builder-registry";
import type { LLMRunResult } from "../../../llm/llm-types";
import type { TradeSignal } from "@electron/shared/ai/trade-signals";
import { edgeEstimateFromStrength } from "@electron/shared/quant/decision-gate";
import { resolveRulesOhlcvRequest } from "./rules-ohlcv-timeframe";
import { createLogger } from "../../../infra/log";

const logger = createLogger("rules-engine-input");

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

function persistRulesEdgeEstimate(
  ctx: EngineRunCtx,
  signal: TradeSignal,
  modelId: string,
): void {
  try {
    const strength = Math.max(0, signal.strength ?? signal.confidence) * 4;
    const edgeEstimate = edgeEstimateFromStrength({
      modelId,
      modelVersion: "rules-1",
      asOf: new Date().toISOString(),
      targetHorizon: "1d",
      strength,
      expectedGrossReturnBps: (signal.strength ?? signal.confidence) * 100,
      expectedCostBps: 5,
      sampleSize: 0,
      predictedProbability: signal.strength ?? signal.confidence,
    });
    ctx.services.decisionTracesRepo.upsertFragment(
      {
        cycleId: ctx.cycleId,
        sessionId: ctx.sessionId,
        instrumentSymbol: ctx.instrument.symbol,
      },
      {
        edgeEstimate,
        aggregation: {
          classifierConfidence: signal.strength ?? signal.confidence,
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
    // observability-only, non-blocking
  }
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
    if (bars.length === 0) {
      // An empty bar set is a data outage, not a healthy "no setup" — the
      // engine will skip at confidence 0.2 ("insufficient bars"), which is
      // indistinguishable from a real no-trade unless we say so loudly here.
      logger.warn(
        {
          sessionId: ctx.sessionId,
          cycleId: ctx.cycleId,
          symbol: ctx.instrument.symbol,
          wireSymbol,
          timeframe,
          barCount,
          brokerType: adapter.brokerType,
        },
        "rules engine received 0 OHLCV bars; cycle will skip as 'insufficient bars'. Check the data feed/credentials.",
      );
    }
    return {
      task: {
        symbol: ctx.instrument.symbol,
        ohlcv: bars.map((bar) => ({ close: bar.close })),
        zScoreEntry: -2,
      },
    };
  },
  applyOutput(state, output, ctx?: EngineRunCtx) {
    const signal = output as TradeSignal;
    if (ctx) {
      persistRulesEdgeEstimate(ctx, signal, "rules:mean-reversion");
    }
    return {
      ...state,
      decision: syntheticDecisionRun("", signal),
    };
  },
};

export const RULES_ENGINE_INPUT_BUILDERS = [rulesMeanReversionInputBuilder];
