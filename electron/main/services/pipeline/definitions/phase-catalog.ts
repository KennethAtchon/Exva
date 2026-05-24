import type {
  PipelineDefinition,
  PipelinePhase,
  WorkerDefinition,
} from "@electron/shared/ai/ai-phase";
import { ENGINE_BINDINGS } from "@electron/shared/ai/ai-phase-config";
import {
  fundamentalSignalSchema,
  reviewSignalSchema,
  technicalSignalSchema,
  tradeSignalSchema,
} from "@electron/shared/ai/trade-signals";
import type { ResearchDiscoveryMode } from "@electron/shared/domain";
import { DECISION_WORKERS } from "./decision.phase";
import { fundamentalWorkersForMode } from "./fundamental.phase";
import { REVIEW_WORKERS } from "./review.phase";
import { selectorDiscoveryWorkersForMode } from "./selector.phase";
import { technicalWorkersForMode } from "./technical.phase";

const PHASE_CATALOG: Record<PipelinePhase, PipelineDefinition> = {
  selector: {
    phase: "selector",
    outputMode: "tool_terminal",
    workers: selectorDiscoveryWorkersForMode("trend_scan"),
    persistence: {
      outputSchemaName: "instrumentSelection",
      traceMode: "aggregate_workers",
    },
  },
  technical: {
    phase: "technical",
    outputMode: "object",
    outputSchema:
      technicalSignalSchema as import("zod").ZodType<
        import("@electron/shared/ai/trade-signals").TechnicalSignal
      >,
    workers: technicalWorkersForMode("trend_scan"),
    engines: [ENGINE_BINDINGS.technicalAggregatorFinalize],
    persistence: {
      outputSchemaName: "technicalSignal",
      traceMode: "aggregate_workers",
    },
  },
  fundamental: {
    phase: "fundamental",
    outputMode: "object",
    outputSchema:
      fundamentalSignalSchema as import("zod").ZodType<
        import("@electron/shared/ai/trade-signals").FundamentalSignal
      >,
    workers: fundamentalWorkersForMode("trend_scan"),
    engines: [ENGINE_BINDINGS.fundamentalAggregatorFinalize],
    persistence: {
      outputSchemaName: "fundamentalSignal",
      traceMode: "aggregate_workers",
    },
  },
  review: {
    phase: "review",
    outputMode: "object",
    outputSchema:
      reviewSignalSchema as import("zod").ZodType<
        import("@electron/shared/ai/trade-signals").ReviewSignal
      >,
    workers: REVIEW_WORKERS,
    engines: [ENGINE_BINDINGS.reviewAggregatorFinalize],
    persistence: {
      outputSchemaName: "reviewSignal",
      traceMode: "aggregate_workers",
    },
  },
  decision: {
    phase: "decision",
    outputMode: "object",
    outputSchema:
      tradeSignalSchema as import("zod").ZodType<
        import("@electron/shared/ai/trade-signals").TradeSignal
      >,
    workers: DECISION_WORKERS,
    engines: [ENGINE_BINDINGS.tradeSignalAggregatorFinalize],
    persistence: {
      outputSchemaName: "tradeSignal",
      traceMode: "aggregate_workers",
    },
  },
};

export function resolvePhaseWorkers(
  phase: PipelinePhase,
  discoveryMode: ResearchDiscoveryMode,
): readonly WorkerDefinition[] {
  if (phase === "selector") return selectorDiscoveryWorkersForMode(discoveryMode);
  if (phase === "technical") return technicalWorkersForMode(discoveryMode);
  if (phase === "fundamental") return fundamentalWorkersForMode(discoveryMode);
  if (phase === "review") return REVIEW_WORKERS;
  return DECISION_WORKERS;
}

export function getPhaseCatalog(phase: PipelinePhase): PipelineDefinition {
  return PHASE_CATALOG[phase];
}

export function listPhaseCatalog(): Array<{
  phase: PipelinePhase;
  definition: PipelineDefinition;
}> {
  return (Object.keys(PHASE_CATALOG) as PipelinePhase[]).map((phase) => ({
    phase,
    definition: PHASE_CATALOG[phase],
  }));
}
