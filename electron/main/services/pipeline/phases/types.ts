import type { InstrumentClass, WorkspaceSession } from "@/lib/types";
import type {
  PipelinePhase,
  WorkerDefinition,
} from "@electron/shared/ai/ai-phase";
import type { LLMRunResult } from "../../llm/llm-types";
import type { SessionStrategyContext } from "@electron/shared/domain";
import type { WorkerToolContext } from "../worker-tools/worker-tool-factory";
import type { AIWorkerRunner } from "../core/types";
import type { AIPhaseServices } from "./services";

export type AIPhaseSource =
  | "cache"
  | "manual_shortlist"
  | "ai_picker"
  | "phase";

export interface AIWorkerTrace {
  workerId: string;
  frontier: number;
  dependsOn: string[];
  requiredForPhase: boolean;
  run: LLMRunResult<unknown>["run"];
  message: LLMRunResult<unknown>["message"];
}

export interface AIPhaseContext {
  phase: PipelinePhase;
  sessionId: string;
  cycleId: string | null;
  tradeId: string | null;
  session: WorkspaceSession;
  instrumentClasses: InstrumentClass[];
  strategyContext: SessionStrategyContext;
  toolContext: WorkerToolContext;
  services: AIPhaseServices;
  runner: AIWorkerRunner;
  input: Record<string, unknown>;
}

export interface AIWorkerBatch<TState> {
  id: string;
  frontier: number;
  resolveWorkers(ctx: AIPhaseContext, state: TState): WorkerDefinition[];
  buildTask(
    ctx: AIPhaseContext,
    state: TState,
    worker: WorkerDefinition,
  ): Record<string, unknown>;
  concurrency: number;
  toleratePartialFailure: boolean;
  minSuccessfulWorkers?: number;
  applyResults(
    ctx: AIPhaseContext,
    state: TState,
    results: Array<{ worker: WorkerDefinition; result: LLMRunResult<unknown> }>,
  ): TState;
}

export interface AIPhaseEntryMode {
  id: string;
  matches(ctx: AIPhaseContext): boolean;
  resolveOutput(ctx: AIPhaseContext): unknown | Promise<unknown>;
}

export interface AIPhaseMetadata {
  inputBuilderIds: readonly string[];
  cachePolicyId?: string;
  stageIds: readonly string[];
  finalizerEngineIds: readonly string[];
}

export interface AIPhase<TState, TOutput> {
  phase: PipelinePhase;
  cachePolicyId?: string;
  inputBuilderIds?: readonly string[];
  /** When false, aggregate trace is returned but not persisted (trade cycle persists on trade insert). */
  persistAggregate?: boolean;
  entryModes: readonly AIPhaseEntryMode[];
  initialState(ctx: AIPhaseContext): TState | Promise<TState>;
  stages: readonly AIWorkerBatch<TState>[];
  finalize(
    ctx: AIPhaseContext,
    state: TState,
    workerTraces: AIWorkerTrace[],
  ): Promise<{
    output: TOutput;
    aggregate?: {
      run: LLMRunResult<TOutput>["run"];
      message: LLMRunResult<TOutput>["message"];
    };
  }>;
  filterOutput?(output: TOutput, ctx: AIPhaseContext): TOutput;
  inspect: AIPhaseMetadata;
}

export interface AIPhaseResult<TOutput> {
  output: TOutput;
  source: AIPhaseSource;
  run?: LLMRunResult<TOutput>["run"];
  message?: LLMRunResult<TOutput>["message"];
  instrumentClasses: InstrumentClass[];
}
