import { ENGINE_BINDINGS } from "@electron/shared/ai/ai-phase-config";
import type { TradeSignal } from "@electron/shared/ai/trade-signals";
import {
  entryTimerOutputSchema,
  signalClassifierOutputSchema,
} from "../../../signal/aggregators/trade-signal-aggregator";
import { runEngineForWorker } from "../../execution/engine-prompt-injector";
import type { AggregatorPlanState } from "../../definitions/aggregator.types";
import { registerEngine, type FinalizerEngine } from "../registry";
import { pickWorkerOutput } from "../worker-output";

const tradeSignalAggregatorEngine: FinalizerEngine<
  AggregatorPlanState,
  TradeSignal
> = {
  id: "trade-signal-aggregator",
  kind: "finalizer",
  async run(ctx, _state, workerResults) {
    const mockRelaxedEntryTiming =
      ctx.toolContext.isMockSession === true &&
      ctx.toolContext.mockScenarioKind === "clean_breakout";

    const effectiveWaitForOpenThreshold = mockRelaxedEntryTiming
      ? Math.min(0.6, ctx.strategyContext.riskConfig.waitForOpenThreshold)
      : ctx.strategyContext.riskConfig.waitForOpenThreshold;

    return runEngineForWorker<TradeSignal>({
      phase: "decision",
      sessionId: ctx.sessionId,
      cycleId: ctx.cycleId,
      strategyContext: ctx.strategyContext,
      bindings: [],
      binding: ENGINE_BINDINGS.tradeSignalAggregatorFinalize,
      task: {
        symbol: ctx.input.instrumentSymbol as string,
        review: ctx.input.review,
        classifier: pickWorkerOutput(workerResults, signalClassifierOutputSchema),
        timer: pickWorkerOutput(workerResults, entryTimerOutputSchema),
        mockRelaxedEntryTiming,
        waitForOpenThreshold: effectiveWaitForOpenThreshold,
      },
    });
  },
};

registerEngine(tradeSignalAggregatorEngine);
