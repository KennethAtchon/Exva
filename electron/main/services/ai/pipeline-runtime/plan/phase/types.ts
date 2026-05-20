import type { InstrumentClass, WorkspaceSession } from "@/lib/types";
import type { PipelinePhase, WorkerDefinition } from "@electron/shared/ai/pipeline-phase";
import type { AgentResult } from "../../../ai-runtime/ai-runtime-types";
import type { SessionStrategyContext } from "@electron/shared/domain";
import type { ToolBuildContext } from "../../context/tool-factory-registry";
import type { PipelineWorkerRunner } from "../../core/types";
import type { PhasePlanServices } from "./services";

export type PhasePlanSource = "cache" | "manual_shortlist" | "ai_picker" | "phase";

export interface PhasePlanWorkerTrace {
  workerId: string;
  frontier: number;
  dependsOn: string[];
  requiredForPhase: boolean;
  run: AgentResult<unknown>["run"];
  message: AgentResult<unknown>["message"];
}

export interface PhasePlanRunContext {
  phase: PipelinePhase;
  sessionId: string;
  cycleId: string | null;
  tradeId: string | null;
  session: WorkspaceSession;
  instrumentClasses: InstrumentClass[];
  strategyContext: SessionStrategyContext;
  toolContext: ToolBuildContext;
  services: PhasePlanServices;
  runner: PipelineWorkerRunner;
  input: Record<string, unknown>;
}

export interface PhasePlanStage<TState> {
  id: string;
  frontier: number;
  resolveWorkers(ctx: PhasePlanRunContext, state: TState): WorkerDefinition[];
  buildTask(ctx: PhasePlanRunContext, state: TState, worker: WorkerDefinition): Record<string, unknown>;
  concurrency: number;
  toleratePartialFailure: boolean;
  minSuccessfulWorkers?: number;
  applyResults(
    ctx: PhasePlanRunContext,
    state: TState,
    results: Array<{ worker: WorkerDefinition; result: AgentResult<unknown> }>,
  ): TState;
}

export interface PhaseEntryMode {
  id: string;
  matches(ctx: PhasePlanRunContext): boolean;
  resolveOutput(ctx: PhasePlanRunContext): unknown | Promise<unknown>;
}

export interface PhasePlanInspectMetadata {
  inputBuilderIds: readonly string[];
  cachePolicyId?: string;
  stageIds: readonly string[];
  finalizerEngineIds: readonly string[];
}

export interface PhasePlan<TState, TOutput> {
  phase: PipelinePhase;
  cachePolicyId?: string;
  inputBuilderIds?: readonly string[];
  /** When false, aggregate trace is returned but not persisted (trade cycle persists on trade insert). */
  persistAggregate?: boolean;
  entryModes: readonly PhaseEntryMode[];
  initialState(ctx: PhasePlanRunContext): TState | Promise<TState>;
  stages: readonly PhasePlanStage<TState>[];
  finalize(
    ctx: PhasePlanRunContext,
    state: TState,
    workerTraces: PhasePlanWorkerTrace[],
  ): Promise<{
    output: TOutput;
    aggregate?: { run: AgentResult<TOutput>["run"]; message: AgentResult<TOutput>["message"] };
  }>;
  filterOutput?(output: TOutput, ctx: PhasePlanRunContext): TOutput;
  inspect: PhasePlanInspectMetadata;
}

export interface PhasePlanRunResult<TOutput> {
  output: TOutput;
  source: PhasePlanSource;
  run?: AgentResult<TOutput>["run"];
  message?: AgentResult<TOutput>["message"];
  instrumentClasses: InstrumentClass[];
}
