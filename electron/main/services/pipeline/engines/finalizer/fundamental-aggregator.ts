import { ENGINE_BINDINGS } from "@electron/shared/ai/ai-phase-config";
import type { FundamentalSignal } from "@electron/shared/ai/trade-signals";
import {
  catalystOutputSchema,
  earningsOutputSchema,
  sentimentOutputSchema,
} from "../../../signals/aggregators/fundamental-aggregator";
import {
  catalystAnalystOutputSchema,
  type CatalystAnalystOutput,
} from "../../../signals/aggregators/catalyst-two-call-aggregator";
import { fundamentalSignalSchema } from "@electron/shared/ai/trade-signals";
import {
  encodeForecastSummary,
  predictionForecastSchema,
} from "@electron/shared/ai/prediction-research";
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
    // Prediction-market forecaster: stash the researched probability in
    // rawSummary so the deterministic edge gate can recover it at decision.
    const forecast = pickWorkerOutput<
      import("@electron/shared/ai/prediction-research").PredictionForecast
    >(workerResults, predictionForecastSchema);
    if (forecast) {
      return fundamentalSignalSchema.parse({
        symbol: ctx.input.instrumentSymbol as string,
        catalystSummary: forecast.reasoning,
        rawSummary: encodeForecastSummary(forecast),
      });
    }

    const analyst = pickWorkerOutput(
      workerResults,
      catalystAnalystOutputSchema,
    ) as CatalystAnalystOutput | null;
    if (analyst) {
      const symbol = ctx.input.instrumentSymbol as string;
      return fundamentalSignalSchema.parse({
        symbol,
        catalystScore: analyst.catalystStrength,
        earningsScore: analyst.priceReactionScore,
        catalystSummary: analyst.reasoning,
        rawSummary: JSON.stringify({ kind: "catalyst-analyst", ...analyst }),
      });
    }

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
