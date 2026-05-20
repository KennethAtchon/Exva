import type { EffectivePlanStageConfig } from "@electron/shared/ai/effective-pipeline-config";
import type { PipelinePhase } from "@electron/shared/ai/pipeline-phase";
import { getCyclePlan, listCyclePlanIds } from "../cycle/registry";
import { getPhasePlan, listPhasePlans } from "../phase/registry";
import type { UnifiedPlanDefinition, UnifiedPlanInspectMetadata } from "./types";
import { DEFAULT_TRADE_CYCLE_STAGES } from "../plans/trade/default-cycle-stages";

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
  if (planId === "default-trade-cycle") {
    return DEFAULT_TRADE_CYCLE_STAGES.map((stage) => {
      if (stage.kind === "engine") {
        return {
          id: stage.id,
          kind: stage.kind,
          executionStage: stage.executionStage,
          engineIds: [stage.engine.engineId],
          inputBuilderIds: [stage.engine.inputBuilderId],
          failurePolicy: stage.failurePolicy,
          required: stage.required,
        };
      }
      if (stage.kind === "engine-chain") {
        return {
          id: stage.id,
          kind: stage.kind,
          executionStage: stage.executionStage,
          engineIds: stage.engines.map((engine) => engine.engineId),
          inputBuilderIds: stage.engines.map((engine) => engine.inputBuilderId),
          failurePolicy: stage.failurePolicy,
          required: stage.required,
        };
      }
      return {
        id: stage.id,
        kind: stage.kind,
        executionStage: stage.executionStage,
        phase: stage.phase,
        failurePolicy: stage.failurePolicy,
        required: stage.required,
      };
    });
  }

  const inspected = inspectUnifiedPlan(planId);
  if (!inspected) return [];
  return inspected.stageIds.map((stageId) => ({
    id: stageId,
    kind: inspected.kind === "phase" ? "phase" : "phase",
    phase: inspected.kind === "phase" ? (inspected.id as PipelinePhase) : undefined,
    required: true,
  }));
}
