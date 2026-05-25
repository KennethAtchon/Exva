import type { EffectivePlanStageConfig } from "@electron/shared/ai/effective-ai-phase-config";
import type { PipelinePhase } from "@electron/shared/ai/ai-phase";
import { getInstrumentAnalysis } from "../../analysis/registry";
import { getAIPhase } from "../../phases/registry";
import type {
  AnyAnalysisDefinition,
  AnalysisInspectMetadata,
} from "./analysis-kinds";

const UNIFIED_PLAN_IDS = new Set<string>();

export function registerUnifiedPlanRef(id: string): void {
  UNIFIED_PLAN_IDS.add(id);
}

function resolveAnalysis(id: string): AnyAnalysisDefinition | undefined {
  const phasePlan = getAIPhase(id as PipelinePhase);
  if (phasePlan) {
    return { kind: "phase", id: id as PipelinePhase, plan: phasePlan };
  }
  const cyclePlan = getInstrumentAnalysis(id);
  if (cyclePlan) {
    return {
      kind: "cycle",
      id,
      plan: cyclePlan as import("../../analysis/types").InstrumentAnalysis<
        import("../../analysis/types").InstrumentAnalysisState
      >,
    };
  }
  return undefined;
}

export function requireAnalysis(id: string): AnyAnalysisDefinition {
  const plan = resolveAnalysis(id);
  if (!plan) throw new Error(`Plan '${id}' is not registered`);
  return plan;
}

function inspectAnalysis(id: string): AnalysisInspectMetadata | undefined {
  const plan = resolveAnalysis(id);
  if (!plan) return undefined;
  if (plan.kind === "phase") {
    return {
      id: plan.id,
      kind: "phase",
      stageIds: plan.plan.stages.map((stage) => stage.id),
      inputBuilderIds: plan.plan.inputEngineIds,
      engineStages: plan.plan.finalizeEngineIds ?? [],
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

export function resolveEffectivePlanStages(
  planId: string,
): EffectivePlanStageConfig[] {
  const plan = resolveAnalysis(planId);
  if (!plan) return [];

  if (plan.kind === "phase") {
    const inspected = inspectAnalysis(planId);
    if (!inspected) return [];
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
