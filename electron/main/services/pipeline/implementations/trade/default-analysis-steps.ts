import type { ExecutionStage } from "@/lib/types";
import type { LLMRunResult } from "../../../llm/llm-types";
import type {
  FundamentalSignal,
  ReviewSignal,
  TechnicalSignal,
  TradeSignal,
} from "@electron/shared/ai/trade-signals";
import { buildAnalysisStepExecute } from "../../analysis/stage-runner";
import type {
  DeclarativeCycleStageConfig,
  StageFailurePolicy,
} from "../../execution/input-builder-registry";
import type {
  InstrumentAnalysisContext,
  InstrumentAnalysisState,
} from "../../analysis/types";

export const DEFAULT_TRADE_CYCLE_STAGES: readonly DeclarativeCycleStageConfig[] =
  [
    {
      id: "candidate_validation",
      kind: "engine",
      executionStage: "candidate_validation",
      required: false,
      failurePolicy: "warn",
      engine: {
        engineId: "candidate-validator",
        engineKind: "validator",
        inputBuilderId: "candidate-validation",
        bindingPhase: "technical",
      },
    },
    {
      id: "technical",
      kind: "phase",
      phase: "technical",
      executionStage: "technical",
      required: true,
      buildInput: (ctx) => ({
        instrumentSymbol: ctx.instrument.symbol,
        selectorEvidence: ctx.instrument.selectorEvidence ?? null,
      }),
      applyOutput: (state, result) => ({
        ...state,
        technical: result as LLMRunResult<TechnicalSignal>,
      }),
    },
    {
      id: "fundamental",
      kind: "phase",
      phase: "fundamental",
      executionStage: "fundamental",
      required: true,
      buildInput: (ctx) => ({
        instrumentSymbol: ctx.instrument.symbol,
        selectorEvidence: ctx.instrument.selectorEvidence ?? null,
      }),
      applyOutput: (state, result) => ({
        ...state,
        fundamental: result as LLMRunResult<FundamentalSignal>,
      }),
    },
    {
      id: "review",
      kind: "phase",
      phase: "review",
      executionStage: "review",
      required: true,
      buildInput: (ctx, state) => ({
        instrumentSymbol: ctx.instrument.symbol,
        technical: state.technical!.output,
        fundamental: state.fundamental!.output,
      }),
      applyOutput: (state, result) => ({
        ...state,
        review: result as LLMRunResult<ReviewSignal>,
      }),
    },
    {
      id: "decision",
      kind: "phase",
      phase: "decision",
      executionStage: "decision",
      required: true,
      buildInput: (ctx, state) => ({
        instrumentSymbol: ctx.instrument.symbol,
        technical: state.technical!.output,
        fundamental: state.fundamental!.output,
        review: state.review!.output,
      }),
      applyOutput: (state, result) => ({
        ...state,
        decision: result as LLMRunResult<TradeSignal>,
      }),
    },
    {
      id: "risk_gate",
      kind: "engine-chain",
      skipIf: (state) => state.decision?.output.action === "skip",
      executionStage: "risk_gate",
      required: true,
      failurePolicy: "reject_trade",
      engines: [
        {
          engineId: "trade-execution-profile",
          engineKind: "execution",
          inputBuilderId: "execution-profile",
          bindingPhase: "decision",
        },
        {
          engineId: "risk-gate",
          engineKind: "policy",
          inputBuilderId: "risk-gate",
          bindingPhase: "decision",
        },
        {
          engineId: "broker-allocation",
          engineKind: "policy",
          inputBuilderId: "broker-allocation",
          bindingPhase: "decision",
        },
      ],
    },
  ] as const;

export function tradeCycleStageFailurePolicy(
  stage: ExecutionStage,
): StageFailurePolicy | undefined {
  return DEFAULT_TRADE_CYCLE_STAGES.find(
    (entry) => (entry.executionStage ?? entry.id) === stage,
  )?.failurePolicy;
}

export function tradeCycleInspectMetadata() {
  const phaseStages = DEFAULT_TRADE_CYCLE_STAGES.filter(
    (stage) => stage.kind === "phase",
  ).map((stage) => stage.phase);
  const engineStages = DEFAULT_TRADE_CYCLE_STAGES.flatMap((stage) => {
    if (stage.kind === "engine") return [stage.engine.engineId];
    if (stage.kind === "engine-chain")
      return stage.engines.map((engine) => engine.engineId);
    return [];
  });
  return {
    stageIds: DEFAULT_TRADE_CYCLE_STAGES.map((stage) => stage.id),
    phaseStages,
    engineStages,
  };
}

export function buildTradeAnalysisSteps(): Array<{
  id: string;
  executionStage?: ExecutionStage;
  required: boolean;
  failurePolicy?: StageFailurePolicy;
  execute: (
    ctx: InstrumentAnalysisContext,
    state: InstrumentAnalysisState,
  ) => Promise<InstrumentAnalysisState>;
}> {
  return DEFAULT_TRADE_CYCLE_STAGES.map((config) => ({
    id: config.id,
    executionStage: config.executionStage ?? (config.id as ExecutionStage),
    required: config.required,
    failurePolicy: config.failurePolicy,
    execute: buildAnalysisStepExecute(config),
  }));
}
