import { ENGINE_BINDINGS } from "@electron/shared/ai/ai-phase-config";
import type { TechnicalSignal } from "@electron/shared/ai/trade-signals";
import {
  chartPatternOutputSchema,
  momentumOutputSchema,
  volumeOutputSchema,
} from "../../../signal/aggregators/technical-aggregator";
import { runEngineForWorker } from "../../execution/engine-prompt-injector";
import type { AggregatorPlanState } from "../../definitions/technical.phase";
import { registerEngine, type FinalizerEngine } from "../registry";
import { pickWorkerOutput } from "../worker-output";

const technicalAggregatorEngine: FinalizerEngine<
  AggregatorPlanState,
  TechnicalSignal
> = {
  id: "technical-aggregator",
  kind: "finalizer",
  async run(ctx, state) {
    const workerPayload = {
      chartPattern: pickWorkerOutput(
        state.workerResults,
        chartPatternOutputSchema,
      ),
      momentum: pickWorkerOutput(state.workerResults, momentumOutputSchema),
      volume: pickWorkerOutput(state.workerResults, volumeOutputSchema),
    };
    return runEngineForWorker<TechnicalSignal>({
      phase: "technical",
      sessionId: ctx.sessionId,
      cycleId: ctx.cycleId,
      strategyContext: ctx.strategyContext,
      bindings: [],
      binding: ENGINE_BINDINGS.technicalAggregatorFinalize,
      task: {
        symbol: ctx.input.instrumentSymbol as string,
        workers: workerPayload,
      },
    });
  },
};

registerEngine(technicalAggregatorEngine);
