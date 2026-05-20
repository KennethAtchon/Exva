import type { EffectivePlanStageConfig } from "@electron/shared/ai/effective-pipeline-config";
import type { PipelinePhase } from "@electron/shared/ai/pipeline-phase";
import { getCyclePlan, listCyclePlanIds } from "../cycle/registry";
import { getPhasePlan, listPhasePlans } from "../phase/registry";
import type { UnifiedPlanDefinition, UnifiedPlanInspectMetadata } from "./types";

const UNIFIED_PLAN_IDS = new Set<string>();

export function registerUnifiedPlanRef(id: string): void {
  UNIFIED_PLAN_IDS.add(id);
}

export function resolveUnifiedPlan(id: string): UnifiedPlanDefinition | undefined {
  const phasePlan = getPhasePlan(id as PipelinePhase);
  if (phasePlan) {
    return { kind: "phase", id: id as PipelinePhase, plan: phasePlan };
  }
  const cyclePlan = getCyclePlan(id);
  if (cyclePlan) {
    return { kind: "cycle", id, plan: cyclePlan as import("../cycle/types").CyclePlan<import("../cycle/types").TradeCyclePlanState> };
  }
  return undefined;
}

export function requireUnifiedPlan(id: string): UnifiedPlanDefinition {
  const plan = resolveUnifiedPlan(id);
  if (!plan) throw new Error(`Plan '${id}' is not registered`);
  return plan;
}

export function listUnifiedPlanIds(): string[] {
  const ids = new Set<string>([...listPhasePlans().map(({ phase }) => phase), ...listCyclePlanIds(), ...UNIFIED_PLAN_IDS]);
  return [...ids].sort();
}

export function inspectUnifiedPlan(id: string): UnifiedPlanInspectMetadata | undefined {
  const plan = resolveUnifiedPlan(id);
  if (!plan) return undefined;
  if (plan.kind === "phase") {
    return {
      id: plan.id,
      kind: "phase",
      stageIds: plan.plan.inspect.stageIds,
      inputBuilderIds: plan.plan.inspect.inputBuilderIds,
      engineStages: plan.plan.inspect.finalizerEngineIds,
    };
  }
  return {
    id: plan.id,
    kind: "cycle",
    stageIds: plan.plan.inspect.stageIds,
    phaseStages: plan.plan.inspect.phaseStages,
    engineStages: plan.plan.inspect.engineStages,
  };
}

export function resolveEffectivePlanStages(planId: string): EffectivePlanStageConfig[] {
  const plan = resolveUnifiedPlan(planId);
  if (!plan) return [];

  if (plan.kind === "phase") {
    const inspected = inspectUnifiedPlan(planId)!;
    return inspected.stageIds.map((stageId) => ({
      id: stageId,
      kind: "phase" as const,
      phase: inspected.id as PipelinePhase,
      required: true,
    }));
  }

  // Cycle plan: derive from inspect metadata + plan.stages for per-stage details
  const { inspect } = plan.plan;
  const phaseSet = new Set<string>(inspect.phaseStages);
  return inspect.stageIds.map((stageId) => {
    const stage = plan.plan.stages.find((s) => s.id === stageId);
    if (phaseSet.has(stageId)) {
      return {
        id: stageId,
        kind: "phase" as const,
        executionStage: stage?.executionStage,
        phase: stageId as PipelinePhase,
        required: stage?.required ?? true,
        failurePolicy: stage?.failurePolicy,
      };
    }
    return {
      id: stageId,
      kind: "engine-chain" as const,
      executionStage: stage?.executionStage,
      required: stage?.required ?? true,
      failurePolicy: stage?.failurePolicy,
    };
  });
}
