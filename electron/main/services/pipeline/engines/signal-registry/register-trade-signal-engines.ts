import { z } from "zod";
import type { TradeSignal } from "@electron/shared/ai/trade-signals";
import { registerSignalEngine } from "./signal-engine-registry";
import { aggregateTechnicalSignal } from "../../../signals/aggregators/technical-aggregator";
import { aggregateFundamentalSignal } from "../../../signals/aggregators/fundamental-aggregator";
import { aggregateReviewSignal } from "../../../signals/aggregators/review-aggregator";
import { aggregateTradeSignal } from "../../../signals/aggregators/trade-signal-aggregator";
import { mergeDiscoveryCandidates } from "../../../signals/scoring/selector-candidate-merger";
import { scoreCandidate } from "../../../signals/scoring/selector-scoring-engine";
import { buildInstrumentSelection } from "../../../signals/scoring/selector-submission-builder";
import { computeTradeTradeExecutionProfile } from "../../../orchestration/trade-execution-profile";
import { computeMeanReversionSignal } from "../../../signals/strategy/mean-reversion-signal";
import { computeTrendFollowingSignal } from "../../../signals/strategy/trend-following-signal";
import { computeBreakoutSignal } from "../../../signals/strategy/breakout-signal";
import { computeOptionsFlowSignal } from "../../../signals/strategy/options-flow-signal";

export function registerTradeSignalEngines(): void {
  registerSignalEngine({
    id: "selector-candidate-merger",
    kind: "transformer",
    inputSchema: z.any(),
    outputSchema: z.any(),
    run: (input: { batches: unknown[][] }) =>
      mergeDiscoveryCandidates(input.batches as never),
  });

  registerSignalEngine({
    id: "selector-scoring-engine",
    kind: "transformer",
    inputSchema: z.any(),
    outputSchema: z.any(),
    run: (input: { candidate: unknown; weights: unknown }) =>
      scoreCandidate(input.candidate as never, input.weights as never),
  });

  registerSignalEngine({
    id: "selector-submission-builder",
    kind: "transformer",
    inputSchema: z.any(),
    outputSchema: z.any(),
    run: (input: { candidates: unknown[]; maxCount: number }) =>
      buildInstrumentSelection(input.candidates as never, input.maxCount),
  });

  registerSignalEngine({
    id: "technical-aggregator",
    kind: "transformer",
    inputSchema: z.any(),
    outputSchema: z.any(),
    run: (input: { symbol: string; workers: unknown }) =>
      aggregateTechnicalSignal(input.symbol, input.workers as never),
  });

  registerSignalEngine({
    id: "fundamental-aggregator",
    kind: "transformer",
    inputSchema: z.any(),
    outputSchema: z.any(),
    run: (input: { symbol: string; workers: unknown }) =>
      aggregateFundamentalSignal(input.symbol, input.workers as never),
  });

  registerSignalEngine({
    id: "review-aggregator",
    kind: "transformer",
    inputSchema: z.any(),
    outputSchema: z.any(),
    run: (input: { symbol: string; workers: unknown }) =>
      aggregateReviewSignal(input.symbol, input.workers as never),
  });

  registerSignalEngine({
    id: "trade-signal-aggregator",
    kind: "transformer",
    inputSchema: z.any(),
    outputSchema: z.any(),
    run: (input: {
      symbol: string;
      review: unknown;
      classifier: unknown;
      timer: unknown;
      waitForOpenThreshold?: number;
    }) =>
      aggregateTradeSignal(
        input.symbol,
        input.review as never,
        input.classifier as never,
        input.timer as never,
        {
          waitForOpenThreshold: input.waitForOpenThreshold,
        },
      ),
  });

  registerSignalEngine({
    id: "rules-mean-reversion",
    kind: "policy",
    inputSchema: z.any(),
    outputSchema: z.any(),
    run: (input) => computeMeanReversionSignal(input as never),
  });

  registerSignalEngine({
    id: "rules-trend-following",
    kind: "policy",
    inputSchema: z.any(),
    outputSchema: z.any(),
    run: (input) => computeTrendFollowingSignal(input as never),
  });

  registerSignalEngine({
    id: "rules-breakout",
    kind: "policy",
    inputSchema: z.any(),
    outputSchema: z.any(),
    run: (input) => computeBreakoutSignal(input as never),
  });

  registerSignalEngine({
    id: "options-flow",
    kind: "policy",
    inputSchema: z.any(),
    outputSchema: z.any(),
    run: (input) => computeOptionsFlowSignal(input as never),
  });

  registerSignalEngine({
    // The prediction-edge input builder computes the full edge-gate signal
    // (it needs forecaster + red-team phase state), so the engine is identity.
    id: "prediction-edge",
    kind: "policy",
    inputSchema: z.any(),
    outputSchema: z.any(),
    run: (input) => input as TradeSignal,
  });

  registerSignalEngine({
    id: "catalyst-trade-decision",
    kind: "policy",
    inputSchema: z.any(),
    outputSchema: z.any(),
    run: (input: unknown) => (input as { signal: TradeSignal }).signal,
  });

  registerSignalEngine({
    id: "trade-execution-profile",
    kind: "execution",
    inputSchema: z.any(),
    outputSchema: z.any(),
    run: (input: unknown) => computeTradeTradeExecutionProfile(input as never),
  });
}
