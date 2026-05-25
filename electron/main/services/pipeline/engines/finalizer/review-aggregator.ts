import { ENGINE_BINDINGS } from "@electron/shared/ai/ai-phase-config";
import type {
  ReviewSignal,
  TechnicalSignal,
} from "@electron/shared/ai/trade-signals";
import { MOCK_CLEAN_BREAKOUT_MOMENTUM_FALLBACK_MARKER } from "@electron/shared/domain/mock-scenario";
import {
  conflictDetectorOutputSchema,
  riskAssessorOutputSchema,
} from "../../../signal/aggregators/review-aggregator";
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
    const workerPayload = {
      conflictDetector: pickWorkerOutput(
        workerResults,
        conflictDetectorOutputSchema,
      ),
      riskAssessor: pickWorkerOutput(workerResults, riskAssessorOutputSchema),
    };
    const mockOverride =
      ctx.toolContext.isMockSession === true &&
      ctx.toolContext.mockScenarioKind === "clean_breakout"
        ? ("clean_breakout" as const)
        : undefined;
    const technical = ctx.input.technical as TechnicalSignal | undefined;
    const momentumFallbackArtifact = Boolean(
      technical?.rawSummary?.includes(
        MOCK_CLEAN_BREAKOUT_MOMENTUM_FALLBACK_MARKER,
      ),
    );
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
        mockOverride,
        momentumFallbackArtifact,
      },
    });
  },
};

registerEngine(reviewAggregatorEngine);
