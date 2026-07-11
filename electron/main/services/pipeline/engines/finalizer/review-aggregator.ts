import { ENGINE_BINDINGS } from "@electron/shared/ai/ai-phase-config";
import type { ReviewSignal } from "@electron/shared/ai/trade-signals";
import {
  conflictDetectorOutputSchema,
  riskAssessorOutputSchema,
} from "../../../signals/aggregators/review-aggregator";
import {
  adversarialReviewerOutputSchema,
  aggregateAdversarialReview,
} from "../../../signals/aggregators/catalyst-two-call-aggregator";
import {
  encodeRedTeamSummary,
  predictionRedTeamSchema,
} from "@electron/shared/ai/prediction-research";
import { reviewSignalSchema } from "@electron/shared/ai/trade-signals";
import { runEngineForWorker } from "../../execution/engine-prompt-injector";
import type { AggregatorPlanState } from "../../definitions/aggregator.types";
import { registerEngine, type FinalizerEngine } from "../registry";
import { pickWorkerOutput } from "../worker-output";

const reviewAggregatorEngine: FinalizerEngine<
  AggregatorPlanState,
  ReviewSignal
> = {
  id: "review-aggregator",
  kind: "finalizer",
  async run(ctx, _state, workerResults) {
    // Prediction-market red team: carry the adjusted probability through
    // rawSummary so the deterministic edge gate can recover it at decision.
    const redTeam = pickWorkerOutput<
      import("@electron/shared/ai/prediction-research").PredictionRedTeam
    >(workerResults, predictionRedTeamSchema);
    if (redTeam) {
      return reviewSignalSchema.parse({
        symbol: ctx.input.instrumentSymbol as string,
        recommendation: redTeam.alreadyPricedIn ? "skip" : "proceed",
        conflictExplanation: redTeam.reasoning,
        rawSummary: encodeRedTeamSummary(redTeam),
      });
    }

    const adversarial = pickWorkerOutput(
      workerResults,
      adversarialReviewerOutputSchema,
    ) as
      | import("../../../signals/aggregators/catalyst-two-call-aggregator").AdversarialReviewerOutput
      | null;
    if (adversarial) {
      return aggregateAdversarialReview(
        ctx.input.instrumentSymbol as string,
        adversarial,
      );
    }

    const workerPayload = {
      conflictDetector: pickWorkerOutput(
        workerResults,
        conflictDetectorOutputSchema,
      ),
      riskAssessor: pickWorkerOutput(workerResults, riskAssessorOutputSchema),
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
