import type { InstrumentClass, WorkspaceSession } from "@/lib/types";
import type {
  PipelinePhase,
  WorkerDefinition,
} from "@electron/shared/ai/ai-phase";
import type { LLMRunResult } from "../../llm/llm-types";
import type {
  ResearchDiscoveryMode,
  SessionStrategyContext,
} from "@electron/shared/domain";
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

interface AIWorkerBatch<TState> {
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

export interface AIPhase<TState, TOutput> {
  phase: PipelinePhase;
  cacheEngineId?: string;
  inputEngineIds?: readonly string[];
  /**
   * The ctx.input key that concatenated input engine sections are written to.
   * Required when inputEngineIds is set. Defaults to "selectionInstructions".
   */
  inputKey?: string;
  entryEngineIds?: readonly string[];
  finalizeEngineIds?: readonly string[];
  /**
   * Schema name written to the aggregate trace. Replaces the hardcoded
   * outputSchemaNameForPhase switch in the interpreter.
   */
  outputSchemaName?: string;
  /**
   * Resolves the workers for a given discovery mode. Used by the effective
   * config layer and catalog to determine workers without needing a full
   * AIPhaseContext. Phases without mode-variant workers may ignore the
   * discoveryMode parameter. Required if the phase participates in the
   * phase catalog (i.e., all five standard phases).
   */
  resolveWorkersForMode?(
    discoveryMode: ResearchDiscoveryMode,
  ): readonly WorkerDefinition[];
  /**
   * Static metadata for the PipelineDefinition catalog (renderer + effective
   * config layer). When set, the phase catalog derives the PipelineDefinition
   * from this field rather than requiring a separate PHASE_METADATA entry.
   *
   * - `outputMode` and `outputSchema` are forwarded to PipelineDefinition.
   * - `engines` are the EngineBinding[] for the legacy pipeline layer (distinct
   *   from finalizeEngineIds which target the new engine registry).
   * - `traceMode` defaults to "aggregate_workers" when omitted.
   */
  catalog?: {
    outputMode: "text" | "object" | "tool_terminal";
    outputSchema?: import("zod").ZodType<unknown>;
    engines?: readonly import("@electron/shared/ai/ai-phase").EngineBinding[];
    traceMode?: "single_phase_run" | "aggregate_workers";
  };
  /**
   * Optional function that extracts structured diagnostic fields from phase
   * output for inclusion in the "phase plan complete" log entry. Return {}
   * to include nothing extra.
   */
  summarize?(output: unknown): Record<string, unknown>;
  /** When false, aggregate trace is returned but not persisted (trade cycle persists on trade insert). */
  persistAggregate?: boolean;
  initialState?(ctx: AIPhaseContext): TState | Promise<TState>;
  stages: readonly AIWorkerBatch<TState>[];
  filterOutput?(output: TOutput, ctx: AIPhaseContext): TOutput;
}

export interface AIPhaseResult<TOutput> {
  output: TOutput;
  source: AIPhaseSource;
  run?: LLMRunResult<TOutput>["run"];
  message?: LLMRunResult<TOutput>["message"];
  instrumentClasses: InstrumentClass[];
}
