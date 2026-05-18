import { z } from "zod";
import type { PipelinePhase, EngineId, EngineKind } from "@electron/shared/ai/pipeline-phase";
import type { SessionStrategyContext } from "@electron/shared/domain";

export interface EngineRunContext {
  sessionId: string;
  phase: PipelinePhase;
  cycleId: string | null;
  strategyContext: SessionStrategyContext;
}

export interface EngineDefinition<TInput = unknown, TOutput = unknown> {
  id: EngineId;
  kind: EngineKind;
  inputSchema: z.ZodType<TInput>;
  outputSchema: z.ZodType<TOutput>;
  run(input: TInput, ctx: EngineRunContext): Promise<TOutput> | TOutput;
}

export type AnyEngineDefinition = EngineDefinition<unknown, unknown>;
