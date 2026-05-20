import { ENGINE_BINDINGS } from "@electron/shared/ai/pipeline-config";
import type { SelectorEvidence } from "@electron/shared/ai/selector-pipeline-candidate";
import type {
  FundamentalSignal,
  ReviewSignal,
  TechnicalSignal,
  TradeSignal,
} from "@electron/shared/ai/pipeline-signals";
import { signalForWorkerPrompt } from "@electron/shared/ai/signal-prompt-payload";
import {
  catalystOutputSchema,
  earningsOutputSchema,
  sentimentOutputSchema,
} from "../../../../engines/aggregators/fundamental-aggregator";
import {
  chartPatternOutputSchema,
  momentumOutputSchema,
  volumeOutputSchema,
} from "../../../../engines/aggregators/technical-aggregator";
import {
  conflictDetectorOutputSchema,
  riskAssessorOutputSchema,
} from "../../../../engines/aggregators/review-aggregator";
import {
  entryTimerOutputSchema,
  signalClassifierOutputSchema,
} from "../../../../engines/aggregators/trade-signal-aggregator";
import { DECISION_PHASE } from "../../../definitions/decision.phase";
import { REVIEW_PHASE } from "../../../definitions/review.phase";
import {
  fundamentalWorkersForMode,
  technicalWorkersForMode,
} from "../../../pipeline-discovery-config";
import { registerPhasePlan } from "../../phase/registry";
import {
  createAggregatorPhasePlan,
  pickWorkerOutput,
} from "./aggregator-phase-plan";

export const TECHNICAL_PLAN = createAggregatorPhasePlan<TechnicalSignal>({
  phase: "technical",
  outputSchemaName: "technicalSignal",
  persistAggregate: false,
  resolveWorkers: (ctx) =>
    technicalWorkersForMode(ctx.strategyContext.researchPosture.discoveryMode),
  buildTask: (ctx) => ({
    instrumentSymbol: ctx.input.instrumentSymbol,
    selectorEvidence: ctx.input.selectorEvidence ?? null,
  }),
  concurrency: 3,
  collectWorkerOutputs: (_workers, results) => ({
    chartPattern: pickWorkerOutput(results, chartPatternOutputSchema),
    momentum: pickWorkerOutput(results, momentumOutputSchema),
    volume: pickWorkerOutput(results, volumeOutputSchema),
  }),
  buildFinalizeTask: (ctx, workerPayload) => ({
    symbol: ctx.input.instrumentSymbol as string,
    workers: workerPayload,
  }),
  finalizeBinding: ENGINE_BINDINGS.technicalAggregatorFinalize,
});

export const FUNDAMENTAL_PLAN = createAggregatorPhasePlan<FundamentalSignal>({
  phase: "fundamental",
  outputSchemaName: "fundamentalSignal",
  persistAggregate: false,
  resolveWorkers: (ctx) =>
    fundamentalWorkersForMode(
      ctx.strategyContext.researchPosture.discoveryMode,
    ),
  buildTask: (ctx) => ({
    instrumentSymbol: ctx.input.instrumentSymbol,
    selectorEvidence: ctx.input.selectorEvidence ?? null,
  }),
  concurrency: 3,
  collectWorkerOutputs: (_workers, results) => ({
    earnings: pickWorkerOutput(results, earningsOutputSchema),
    catalyst: pickWorkerOutput(results, catalystOutputSchema),
    sentiment: pickWorkerOutput(results, sentimentOutputSchema),
  }),
  buildFinalizeTask: (ctx, workerPayload) => ({
    symbol: ctx.input.instrumentSymbol as string,
    workers: workerPayload,
  }),
  finalizeBinding: ENGINE_BINDINGS.fundamentalAggregatorFinalize,
});

export const REVIEW_PLAN = createAggregatorPhasePlan<ReviewSignal>({
  phase: "review",
  outputSchemaName: "reviewSignal",
  persistAggregate: false,
  resolveWorkers: () => REVIEW_PHASE.workers,
  buildTask: (ctx) => ({
    instrumentSymbol: ctx.input.instrumentSymbol,
    technicalSignal: JSON.stringify(
      signalForWorkerPrompt(ctx.input.technical as TechnicalSignal),
    ),
    fundamentalSignal: JSON.stringify(
      signalForWorkerPrompt(ctx.input.fundamental as FundamentalSignal),
    ),
  }),
  concurrency: 2,
  collectWorkerOutputs: (_workers, results) => ({
    conflictDetector: pickWorkerOutput(results, conflictDetectorOutputSchema),
    riskAssessor: pickWorkerOutput(results, riskAssessorOutputSchema),
  }),
  buildFinalizeTask: (ctx, workerPayload) => ({
    symbol: ctx.input.instrumentSymbol as string,
    workers: workerPayload,
  }),
  finalizeBinding: ENGINE_BINDINGS.reviewAggregatorFinalize,
});

export const DECISION_PLAN = createAggregatorPhasePlan<TradeSignal>({
  phase: "decision",
  outputSchemaName: "tradeSignal",
  persistAggregate: false,
  resolveWorkers: () => DECISION_PHASE.workers,
  buildTask: (ctx) => ({
    instrumentSymbol: ctx.input.instrumentSymbol,
    technicalSignal: JSON.stringify(
      signalForWorkerPrompt(ctx.input.technical as TechnicalSignal),
    ),
    fundamentalSignal: JSON.stringify(
      signalForWorkerPrompt(ctx.input.fundamental as FundamentalSignal),
    ),
    reviewSignal: JSON.stringify(
      signalForWorkerPrompt(ctx.input.review as ReviewSignal),
    ),
  }),
  concurrency: 2,
  collectWorkerOutputs: (_workers, results) => ({
    classifier: pickWorkerOutput(results, signalClassifierOutputSchema),
    timer: pickWorkerOutput(results, entryTimerOutputSchema),
  }),
  buildFinalizeTask: (ctx, workerPayload) => {
    const payload = workerPayload as { classifier: unknown; timer: unknown };
    return {
      symbol: ctx.input.instrumentSymbol as string,
      review: ctx.input.review,
      classifier: payload.classifier,
      timer: payload.timer,
    };
  },
  finalizeBinding: ENGINE_BINDINGS.tradeSignalAggregatorFinalize,
});

export function registerTradeAnalysisPhasePlans(): void {
  registerPhasePlan(TECHNICAL_PLAN);
  registerPhasePlan(FUNDAMENTAL_PLAN);
  registerPhasePlan(REVIEW_PLAN);
  registerPhasePlan(DECISION_PLAN);
}

export type TradeAnalysisPhaseInput = {
  instrumentSymbol: string;
  selectorEvidence?: SelectorEvidence | null;
};
