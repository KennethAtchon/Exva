import { z } from "zod";
import { registerEngine } from "./engine-registry";
import { aggregateTechnicalSignal } from "./technical-aggregator";
import { aggregateFundamentalSignal } from "./fundamental-aggregator";
import { aggregateReviewSignal } from "./review-aggregator";
import { aggregateTradeSignal } from "./trade-signal-aggregator";
import { mergeCandidates } from "./selector-candidate-merger";
import { scoreCandidate } from "./selector-scoring-engine";
import { buildInstrumentSelection } from "./selector-submission-builder";
import { computeExecutionProfile } from "./execution-profile-engine";

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
