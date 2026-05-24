import { ENGINE_BINDINGS } from "@electron/shared/ai/ai-phase-config";
import type { ReviewSignal } from "@electron/shared/ai/trade-signals";
import {
  conflictDetectorOutputSchema,
  riskAssessorOutputSchema,
} from "../../../signal/aggregators/review-aggregator";
import { runEngineForWorker } from "../../execution/engine-prompt-injector";
import type { AggregatorPlanState } from "../../definitions/review.phase";
import { registerEngine, type FinalizerEngine } from "../registry";
import { pickWorkerOutput } from "../worker-output";

const reviewAggregatorEngine: FinalizerEngine<
  AggregatorPlanState,
  ReviewSignal
> = {
  id: "review-aggregator",
  kind: "finalizer",
  async run(ctx, state) {
    const workerPayload = {
      conflictDetector: pickWorkerOutput(
        state.workerResults,
        conflictDetectorOutputSchema,
      ),
      riskAssessor: pickWorkerOutput(
        state.workerResults,
        riskAssessorOutputSchema,
      ),
    };
    return runEngineForWorker<ReviewSignal>({
      phase: "review",
      sessionId: ctx.sessionId,
      cycleId: ctx.cycleId,
      strategyContext: ctx.strategyContext,
      bindings: [],
      binding: ENGINE_BINDINGS.reviewAggregatorFinalize,
      task: {
        symbol: ctx.input.instrumentSymbol as string,
        workers: workerPayload,
      },
    });
  },
};

registerEngine(reviewAggregatorEngine);
