import { z } from "zod";
import type { TradeSignal } from "@electron/shared/ai/trade-signals";
import { registerSignalEngine } from "./signal-engine-registry";
import { aggregateTechnicalSignal } from "../aggregators/technical-aggregator";
import { aggregateFundamentalSignal } from "../aggregators/fundamental-aggregator";
import { aggregateReviewSignal } from "../aggregators/review-aggregator";
import { aggregateTradeSignal } from "../aggregators/trade-signal-aggregator";
import { mergeDiscoveryCandidates } from "../scoring/selector-candidate-merger";
import { scoreCandidate } from "../scoring/selector-scoring-engine";
import { buildInstrumentSelection } from "../scoring/selector-submission-builder";
import { computeTradeTradeExecutionProfile } from "../execution/trade-execution-profile";
import { computeMeanReversionSignal } from "../rules/mean-reversion-signal";
import { computeTrendFollowingSignal } from "../rules/trend-following-signal";
import { computeBreakoutSignal } from "../rules/breakout-signal";

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
