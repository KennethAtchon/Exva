import type { AgentMessage, AgentRun } from "@/lib/types";
import type { EngineInputBuilder } from "../../execution/input-builder-registry";
import type { LLMRunResult } from "../../../llm/llm-types";
import {
  tradeSignalSchema,
  type TradeSignal,
} from "@electron/shared/ai/trade-signals";
import {
  decodeForecastSummary,
  decodeRedTeamSummary,
} from "@electron/shared/ai/prediction-research";
import { combineForecasterAndRedTeam } from "@electron/shared/quant/prediction-forecast";
import {
  evaluatePredictionEdge,
  type PredictionTradeRule,
} from "@electron/shared/quant/prediction-edge";
import { requireExperience } from "../../../../experiences/index";
import { createLogger } from "../../../infra/log";

const logger = createLogger("prediction-edge-input");

/**
 * Deterministic edge gate for the prediction-market pipeline (Part C.6). Reads
 * the LLM forecaster's probability (fundamental phase) and the red team's
 * adjusted probability (review phase), combines them — disagreement widens the
 * uncertainty band — then runs the deterministic edge gate against the market
 * mid and the experience's cost model. The LLM forms the view; this engine
 * decides and sizes. No LLM here.
 */

/** Net edge (after costs) the gap must clear; ~3% for v1. */
const MIN_NET_EDGE = 0.03;
/** Reject when the red-team-widened band is wider than this. */
const MAX_UNCERTAINTY_BPS = 2500;
/** No live calibration buckets yet, so don't gate on sample size in v1. */
const MIN_CALIBRATION_SAMPLE = 0;

type PredictionMetadata = {
  marketMid?: number;
  resolutionTime?: string;
};

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
    output_schema_name: "prediction-edge",
    parse_fallback: false,
    strategy_snapshot_json: "{}",
    market_snapshot_json: null,
    created_at: new Date().toISOString(),
  };
  return { run, message, output: signal };
}

function parseMetadata(json: string | null | undefined): PredictionMetadata {
  if (!json) return {};
  try {
    return JSON.parse(json) as PredictionMetadata;
  } catch {
    return {};
  }
}

function hoursToResolution(
  resolutionTime: string | undefined,
): number | undefined {
  if (!resolutionTime) return undefined;
  const ms = new Date(resolutionTime).getTime() - Date.now();
  return Number.isFinite(ms) ? ms / (1000 * 60 * 60) : undefined;
}

function skip(symbol: string, reason: string): TradeSignal {
  return tradeSignalSchema.parse({
    symbol,
    action: "skip",
    executionStrategy: "prediction_market",
    entryPrice: null,
    confidence: 0.2,
    reasoning: reason,
  });
}

export const predictionEdgeInputBuilder: EngineInputBuilder = {
  id: "prediction-edge-input",
  build({ planCtx: ctx, state }) {
    const symbol = ctx.instrument.symbol;
    const forecast = decodeForecastSummary(
      state.fundamental?.output.rawSummary,
    );
    const redTeam = decodeRedTeamSummary(state.review?.output.rawSummary);

    if (!forecast) {
      return {
        task: skip(
          symbol,
          "No forecaster probability available; cannot size an edge.",
        ),
      };
    }

    // The red team is advisory; if it's missing, fall back to the forecaster's
    // own band (no extra widening).
    const combined = combineForecasterAndRedTeam(
      { pHat: forecast.pHat, uncertaintyBps: forecast.uncertaintyBps },
      redTeam
        ? { pHat: redTeam.pHat, uncertaintyBps: redTeam.uncertaintyBps }
        : { pHat: forecast.pHat, uncertaintyBps: forecast.uncertaintyBps },
    );

    if (forecast.informationFreshness === "stale" || redTeam?.alreadyPricedIn) {
      return {
        task: skip(
          symbol,
          "Catalyst already priced in (stale information); no edge.",
        ),
      };
    }

    const meta = parseMetadata(ctx.instrument.instrumentMetadataJson);
    if (meta.marketMid == null) {
      return {
        task: skip(
          symbol,
          "No market mid price available; cannot compute edge.",
        ),
      };
    }

    const costs = (() => {
      try {
        return requireExperience(ctx.session.experienceId).researchContract
          .costs;
      } catch {
        return { spreadBps: 50, slippageBps: 10, commissionBps: 0 };
      }
    })();

    const rule: PredictionTradeRule = {
      minNetEdge: MIN_NET_EDGE,
      minCalibrationSampleSize: MIN_CALIBRATION_SAMPLE,
      maxUncertaintyBps: MAX_UNCERTAINTY_BPS,
    };

    const result = evaluatePredictionEdge(
      {
        predictedProbability: combined.pHat,
        marketMidProbability: meta.marketMid,
        spreadBps: costs.spreadBps,
        feeBps: costs.commissionBps ?? 0,
        slippageBps: costs.slippageBps,
        sampleSize: 0,
        calibrationBucket: null,
        modelId: `pm-forecast:${ctx.session.experienceId}`,
        modelVersion: "v1",
        uncertaintyBps: combined.uncertaintyBps,
      },
      rule,
      new Date().toISOString(),
      hoursToResolution(meta.resolutionTime),
    );

    if (result.side === "skip") {
      return {
        task: skip(symbol, result.skipReason ?? "Edge did not clear the gate."),
      };
    }

    // Confidence reflects how far the net edge clears the threshold, capped.
    const confidence = Math.min(0.95, 0.5 + result.netEdge * 2);
    logger.debug(
      {
        symbol,
        forecastPHat: forecast.pHat,
        redTeamPHat: redTeam?.pHat ?? null,
        combinedPHat: combined.pHat,
        marketMid: meta.marketMid,
        netEdge: result.netEdge,
        side: result.side,
      },
      "prediction-edge: tradeable edge",
    );
    return {
      task: tradeSignalSchema.parse({
        symbol,
        action: result.side === "BUY" ? "buy" : "sell",
        executionStrategy: "prediction_market",
        entryPrice: null,
        confidence,
        reasoning: `Forecast ${(combined.pHat * 100).toFixed(0)}% vs market ${(meta.marketMid * 100).toFixed(0)}%; net edge ${(result.netEdge * 100).toFixed(1)}% after costs, band ±${(combined.uncertaintyBps / 100).toFixed(1)}%.`,
      }),
    };
  },
  applyOutput(state, output) {
    const signal = output as TradeSignal;
    return { ...state, decision: syntheticDecisionRun(signal) };
  },
};

export const PREDICTION_EDGE_INPUT_BUILDERS = [predictionEdgeInputBuilder];
