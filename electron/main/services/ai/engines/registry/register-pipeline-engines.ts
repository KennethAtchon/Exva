import { z } from "zod";
import { registerEngine } from "./engine-registry";
import { aggregateTechnicalSignal } from "../aggregators/technical-aggregator";
import { aggregateFundamentalSignal } from "../aggregators/fundamental-aggregator";
import { aggregateReviewSignal } from "../aggregators/review-aggregator";
import { aggregateTradeSignal } from "../aggregators/trade-signal-aggregator";
import { mergeCandidates } from "../selector/selector-candidate-merger";
import { scoreCandidate } from "../selector/selector-scoring-engine";
import { buildInstrumentSelection } from "../selector/selector-submission-builder";
import { computeExecutionProfile } from "../execution/execution-profile-engine";

export function registerPipelineEngines(): void {
  registerEngine({
    id: "selector-candidate-merger",
    kind: "transformer",
    inputSchema: z.any(),
    outputSchema: z.any(),
    run: (input: { batches: unknown[][] }) => mergeCandidates(input.batches as never),
  });

  registerEngine({
    id: "selector-scoring-engine",
    kind: "transformer",
    inputSchema: z.any(),
    outputSchema: z.any(),
    run: (input: { candidate: unknown; weights: unknown }) =>
      scoreCandidate(input.candidate as never, input.weights as never),
  });

  registerEngine({
    id: "selector-submission-builder",
    kind: "transformer",
    inputSchema: z.any(),
    outputSchema: z.any(),
    run: (input: { candidates: unknown[]; maxCount: number }) =>
      buildInstrumentSelection(input.candidates as never, input.maxCount),
  });

  registerEngine({
    id: "technical-aggregator",
    kind: "transformer",
    inputSchema: z.any(),
    outputSchema: z.any(),
    run: (input: { symbol: string; workers: unknown }) =>
      aggregateTechnicalSignal(input.symbol, input.workers as never),
  });

  registerEngine({
    id: "fundamental-aggregator",
    kind: "transformer",
    inputSchema: z.any(),
    outputSchema: z.any(),
    run: (input: { symbol: string; workers: unknown }) =>
      aggregateFundamentalSignal(input.symbol, input.workers as never),
  });

  registerEngine({
    id: "review-aggregator",
    kind: "transformer",
    inputSchema: z.any(),
    outputSchema: z.any(),
    run: (input: { symbol: string; workers: unknown }) =>
      aggregateReviewSignal(input.symbol, input.workers as never),
  });

  registerEngine({
    id: "trade-signal-aggregator",
    kind: "transformer",
    inputSchema: z.any(),
    outputSchema: z.any(),
    run: (input: { symbol: string; review: unknown; classifier: unknown; timer: unknown }) =>
      aggregateTradeSignal(
        input.symbol,
        input.review as never,
        input.classifier as never,
        input.timer as never,
      ),
  });

  registerEngine({
    id: "execution-profile-engine",
    kind: "execution",
    inputSchema: z.any(),
    outputSchema: z.any(),
    run: (input: unknown) => computeExecutionProfile(input as never),
  });
}
