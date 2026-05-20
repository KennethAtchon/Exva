import type { EffectivePlanStageConfig } from "@electron/shared/ai/effective-pipeline-config";
import type { CyclePlan, TradeCyclePlanState } from "../cycle/types";
import type { PhasePlan } from "../phase/types";

export type PlanKind = "phase" | "cycle";

export type UnifiedPlanDefinition =
  | {
      kind: "phase";
      id: import("@electron/shared/ai/pipeline-phase").PipelinePhase;
      plan: PhasePlan<unknown, unknown>;
    }
  | { kind: "cycle"; id: string; plan: CyclePlan<TradeCyclePlanState> };

export interface UnifiedPlanInspectMetadata {
  id: string;
  kind: PlanKind;
  stageIds: readonly string[];
  phaseStages?: readonly import("@electron/shared/ai/pipeline-phase").PipelinePhase[];
  engineStages?: readonly string[];
  inputBuilderIds?: readonly string[];
}

export type { EffectivePlanStageConfig };
