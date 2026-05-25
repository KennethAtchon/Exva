import type { LLMRunResult } from "../../llm/llm-types";
import type { WorkerDefinition } from "@electron/shared/ai/ai-phase";
import type { AIPhaseContext, AIPhaseSource } from "../phases/types";

export type PhaseEngineKind = "input" | "entry_mode" | "cache" | "finalizer";

export interface Engine {
  id: string;
  kind: PhaseEngineKind;
}

export interface InputEngine extends Engine {
  kind: "input";
  build(ctx: AIPhaseContext): Promise<string | null>;
}

export interface EntryModeEngine extends Engine {
  kind: "entry_mode";
  /**
   * The AIPhaseSource value reported in AIPhaseResult when this entry mode
   * short-circuits execution. Defaults to "phase" if not set.
   */
  source?: AIPhaseSource;
  matches(ctx: AIPhaseContext): boolean | Promise<boolean>;
  resolve(ctx: AIPhaseContext): unknown | Promise<unknown>;
}

interface CacheWriteMeta {
  agentRunId: string;
  cycleId: string;
}

export interface CacheEngine<TOutput = unknown> extends Engine {
  kind: "cache";
  fingerprint(ctx: AIPhaseContext): string;
  read(ctx: AIPhaseContext, fingerprint: string): TOutput | null;
  write(
    ctx: AIPhaseContext,
    fingerprint: string,
    output: TOutput,
    meta: CacheWriteMeta,
  ): void;
  /**
   * Optional guard called before write. Return false to skip the cache write
   * (e.g., output is empty or invalid). Defaults to always writing if absent.
   */
  shouldWrite?(output: TOutput): boolean;
}

export type PhaseWorkerResult = {
  worker: WorkerDefinition;
  result: LLMRunResult<unknown>;
};

export interface FinalizerEngine<
  TState = unknown,
  TOutput = unknown,
> extends Engine {
  kind: "finalizer";
  run(
    ctx: AIPhaseContext,
    state: TState,
    workerResults: PhaseWorkerResult[],
  ): Promise<TState | TOutput>;
}

const ENGINES = new Map<string, Engine>();

export function registerEngine<T extends Engine>(engine: T): void {
  ENGINES.set(engine.id, engine);
}

export function resolveEngine<T extends Engine>(
  id: string,
  kind: PhaseEngineKind,
): T {
  const engine = ENGINES.get(id);
  if (!engine) throw new Error(`Engine '${id}' is not registered`);
  if (engine.kind !== kind) {
    throw new Error(
      `Engine '${id}' is kind '${engine.kind}', expected '${kind}'`,
    );
  }
  return engine as T;
}
