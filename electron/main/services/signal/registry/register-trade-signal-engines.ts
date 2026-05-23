import { z } from "zod";
import { registerSignalEngine } from "./signal-engine-registry";
import { aggregateTechnicalSignal } from "../aggregators/technical-aggregator";
import { aggregateFundamentalSignal } from "../aggregators/fundamental-aggregator";
import { aggregateReviewSignal } from "../aggregators/review-aggregator";
import { aggregateTradeSignal } from "../aggregators/trade-signal-aggregator";
import { mergeDiscoveryCandidates } from "../scoring/selector-candidate-merger";
import { scoreCandidate } from "../scoring/selector-scoring-engine";
import { buildInstrumentSelection } from "../scoring/selector-submission-builder";
import { computeTradeTradeExecutionProfile } from "../execution/trade-execution-profile";

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
      mockRelaxedEntryTiming?: boolean;
    }) =>
      aggregateTradeSignal(
        input.symbol,
        input.review as never,
        input.classifier as never,
        input.timer as never,
        {
          mockRelaxedEntryTiming: input.mockRelaxedEntryTiming,
        },
      ),
  });

  registerSignalEngine({
    id: "trade-execution-profile",
    kind: "execution",
    inputSchema: z.any(),
    outputSchema: z.any(),
    run: (input: unknown) => computeTradeTradeExecutionProfile(input as never),
  });
}
