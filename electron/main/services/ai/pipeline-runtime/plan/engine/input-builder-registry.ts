import type {
  EngineKind,
  PipelinePhase,
} from "@electron/shared/ai/pipeline-phase";
import type { AgentResult } from "../../../ai-runtime/ai-runtime-types";
import type { CyclePlanRunContext, TradeCyclePlanState } from "../cycle/types";

export type EngineInputBuilderId = string;

export type EngineRunCtx = Pick<
  CyclePlanRunContext,
  | "sessionId"
  | "cycleId"
  | "tradeId"
  | "instrument"
  | "sessionConfig"
  | "instrumentClasses"
  | "strategyContext"
  | "services"
>;

export interface EngineInputBuilderContext {
  planCtx: EngineRunCtx;
  state: TradeCyclePlanState;
}

export interface EngineInputBuilder {
  id: EngineInputBuilderId;
  build(
    ctx: EngineInputBuilderContext,
  ): EngineInputBuildResult | Promise<EngineInputBuildResult>;
  applyOutput?(
    state: TradeCyclePlanState,
    output: unknown,
  ): TradeCyclePlanState;
}

export type EngineInputBuildResult = {
  task: unknown;
  statePatch?: Partial<TradeCyclePlanState>;
};

const ENGINE_INPUT_BUILDERS = new Map<
  EngineInputBuilderId,
  EngineInputBuilder
>();

export function registerEngineInputBuilder(builder: EngineInputBuilder): void {
  ENGINE_INPUT_BUILDERS.set(builder.id, builder);
}

export function getEngineInputBuilder(
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
      skipIf?: (state: TradeCyclePlanState) => boolean;
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
        ctx: CyclePlanRunContext,
        state: TradeCyclePlanState,
      ) => Record<string, unknown>;
      applyOutput: (
        state: TradeCyclePlanState,
        result: AgentResult<unknown>,
      ) => TradeCyclePlanState;
    };

export type StageFailurePolicy = "warn" | "fail" | "reject_trade";

export function listEngineInputBuilderIds(): string[] {
  return [...ENGINE_INPUT_BUILDERS.keys()];
}
