import { ENGINE_BINDINGS } from "@electron/shared/ai/ai-phase-config";
import type { FundamentalSignal } from "@electron/shared/ai/trade-signals";
import {
  catalystOutputSchema,
  earningsOutputSchema,
  sentimentOutputSchema,
} from "../../../signal/aggregators/fundamental-aggregator";
import { runEngineForWorker } from "../../execution/engine-prompt-injector";
import type { AggregatorPlanState } from "../../definitions/aggregator.types";
import { registerEngine, type FinalizerEngine } from "../registry";
import { pickWorkerOutput } from "../worker-output";

const fundamentalAggregatorEngine: FinalizerEngine<
  AggregatorPlanState,
  FundamentalSignal
> = {
  id: "fundamental-aggregator",
  kind: "finalizer",
  async run(ctx, _state, workerResults) {
    const workerPayload = {
      earnings: pickWorkerOutput(workerResults, earningsOutputSchema),
      catalyst: pickWorkerOutput(workerResults, catalystOutputSchema),
      sentiment: pickWorkerOutput(workerResults, sentimentOutputSchema),
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
