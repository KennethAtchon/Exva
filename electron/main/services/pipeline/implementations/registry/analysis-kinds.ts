import type { EffectivePlanStageConfig } from "@electron/shared/ai/effective-ai-phase-config";
import type { InstrumentAnalysis, InstrumentAnalysisState } from "../../analysis/types";
import type { AIPhase } from "../../phases/types";

export type AnalysisKind = "phase" | "cycle";

export type AnyAnalysisDefinition =
  | {
      kind: "phase";
      id: import("@electron/shared/ai/ai-phase").PipelinePhase;
      plan: AIPhase<unknown, unknown>;
    }
  | { kind: "cycle"; id: string; plan: InstrumentAnalysis<InstrumentAnalysisState> };

export interface AnalysisInspectMetadata {
  id: string;
  kind: AnalysisKind;
  stageIds: readonly string[];
  phaseStages?: readonly import("@electron/shared/ai/ai-phase").PipelinePhase[];
  engineStages?: readonly string[];
  inputBuilderIds?: readonly string[];
}

export type { EffectivePlanStageConfig };
