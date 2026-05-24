import { ENGINE_BINDINGS } from "@electron/shared/ai/ai-phase-config";
import type { FundamentalSignal } from "@electron/shared/ai/trade-signals";
import {
  catalystOutputSchema,
  earningsOutputSchema,
  sentimentOutputSchema,
} from "../../../signal/aggregators/fundamental-aggregator";
import { runEngineForWorker } from "../../execution/engine-prompt-injector";
import type { AggregatorPlanState } from "../../definitions/fundamental.phase";
import { registerEngine, type FinalizerEngine } from "../registry";
import { pickWorkerOutput } from "../worker-output";

const fundamentalAggregatorEngine: FinalizerEngine<
  AggregatorPlanState,
  FundamentalSignal
> = {
  id: "fundamental-aggregator",
  kind: "finalizer",
  async run(ctx, state) {
    const workerPayload = {
      earnings: pickWorkerOutput(state.workerResults, earningsOutputSchema),
      catalyst: pickWorkerOutput(state.workerResults, catalystOutputSchema),
      sentiment: pickWorkerOutput(state.workerResults, sentimentOutputSchema),
    };
    return runEngineForWorker<FundamentalSignal>({
      phase: "fundamental",
      sessionId: ctx.sessionId,
      cycleId: ctx.cycleId,
      strategyContext: ctx.strategyContext,
      bindings: [],
      binding: ENGINE_BINDINGS.fundamentalAggregatorFinalize,
      task: {
        symbol: ctx.input.instrumentSymbol as string,
        workers: workerPayload,
      },
    });
  },
};

registerEngine(fundamentalAggregatorEngine);
