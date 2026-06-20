import type { EngineKind, PipelinePhase } from "@electron/shared/ai/ai-phase";
import type { LLMRunResult } from "../../llm/llm-types";
import type {
  InstrumentAnalysisContext,
  InstrumentAnalysisState,
} from "../analysis/types";

export type EngineInputBuilderId = string;

export type EngineRunCtx = Pick<
  InstrumentAnalysisContext,
  | "sessionId"
  | "cycleId"
  | "tradeId"
  | "session"
  | "instrument"
  | "sessionConfig"
  | "instrumentClasses"
  | "strategyContext"
  | "services"
>;

interface EngineInputBuilderContext {
  planCtx: EngineRunCtx;
  state: InstrumentAnalysisState;
}

export interface EngineInputBuilder {
  id: EngineInputBuilderId;
  build(
    ctx: EngineInputBuilderContext,
  ): EngineInputBuildResult | Promise<EngineInputBuildResult>;
  applyOutput?(
    state: InstrumentAnalysisState,
    output: unknown,
    ctx?: EngineRunCtx,
  ): InstrumentAnalysisState;
}

type EngineInputBuildResult = {
  task: unknown;
  statePatch?: Partial<InstrumentAnalysisState>;
};

const ENGINE_INPUT_BUILDERS = new Map<
  EngineInputBuilderId,
  EngineInputBuilder
>();

export function registerSignalEngineInputBuilder(
  builder: EngineInputBuilder,
): void {
  ENGINE_INPUT_BUILDERS.set(builder.id, builder);
}

export function getSignalEngineInputBuilder(
  id: EngineInputBuilderId,
): EngineInputBuilder {
  const builder = ENGINE_INPUT_BUILDERS.get(id);
  if (!builder)
    throw new Error(`Engine input builder '${id}' is not registered`);
  return builder;
}

export type EngineStageConfig = {
  engineId: string;
  engineKind: EngineKind;
  inputBuilderId: EngineInputBuilderId;
  bindingPhase: PipelinePhase;
};

export type DeclarativeCycleStageConfig =
  | {
      id: string;
      kind: "engine";
      engine: EngineStageConfig;
      executionStage?: import("@/lib/types").ExecutionStage;
      required: boolean;
      failurePolicy?: StageFailurePolicy;
    }
  | {
      id: string;
      kind: "engine-chain";
      engines: EngineStageConfig[];
      skipIf?: (state: InstrumentAnalysisState) => boolean;
      executionStage?: import("@/lib/types").ExecutionStage;
      required: boolean;
      failurePolicy?: StageFailurePolicy;
    }
  | {
      id: string;
      kind: "phase";
      phase: PipelinePhase;
      executionStage?: import("@/lib/types").ExecutionStage;
      required: boolean;
      failurePolicy?: StageFailurePolicy;
      buildInput: (
        ctx: InstrumentAnalysisContext,
        state: InstrumentAnalysisState,
      ) => Record<string, unknown>;
      applyOutput: (
        state: InstrumentAnalysisState,
        result: LLMRunResult<unknown>,
      ) => InstrumentAnalysisState;
    };

export type StageFailurePolicy = "warn" | "fail" | "reject_trade";

export function listEngineInputBuilderIds(): string[] {
  return [...ENGINE_INPUT_BUILDERS.keys()];
}
