import type { ExecutionStage, InstrumentClass, SessionConfig, WorkspaceSession } from "@/lib/types";
import type { PipelinePhase } from "@electron/shared/ai/pipeline-phase";
import type { StageFailurePolicy } from "../engine/input-builder-registry";
import type { PhasePlanRunResult } from "../phase/types";
import type { SelectorEvidence } from "@electron/shared/ai/selector-pipeline-candidate";
import type { FundamentalSignal, ReviewSignal, TechnicalSignal, TradeSignal } from "@electron/shared/ai/pipeline-signals";
import type { AgentResult } from "../../../ai-runtime/ai-runtime-types";
import type { OrderRequest } from "../../../../broker/adapters/broker-adapter";
import type { ExecutionProfile } from "../../../engines/execution/execution-profile-engine";
import type { SessionStrategyContext } from "@electron/shared/domain";
import type { ToolBuildContext } from "../../context/tool-factory-registry";
import type { CyclePlanServices } from "./services";
import type { ToolStepTrace } from "../../../../orchestration/policy/candidate-validation-service";

export type TradeCycleInstrument = {
  symbol: string;
  instrumentClass: InstrumentClass;
  instrumentDisplayName?: string;
  predictionOutcome?: "YES" | "NO" | null;
  instrumentMetadataJson?: string | null;
  selectorEvidence?: SelectorEvidence | null;
  selectorTraces?: ToolStepTrace[];
};

export type QuoteSnapshot = {
  price: number;
  timestamp: string;
};

export type BrokerAllocationResult = {
  allocation: { ok: boolean; reason?: string; warning?: string };
  conflict: { ok: boolean; reason?: string };
};

export interface TradeCyclePlanState {
  quoteSnapshot?: QuoteSnapshot;
  technical?: AgentResult<TechnicalSignal>;
  fundamental?: AgentResult<FundamentalSignal>;
  review?: AgentResult<ReviewSignal>;
  decision?: AgentResult<TradeSignal>;
  executionProfile?: ExecutionProfile;
  riskOrder?: OrderRequest;
  brokerAccountId?: string;
  brokerAllocation?: BrokerAllocationResult;
}

export interface TradePipelineResult {
  state: TradeCyclePlanState;
  totalAiCostUsd: number;
}

export interface CyclePlanRunContext {
  cyclePlanId: string;
  sessionId: string;
  cycleId: string;
  tradeId: string | null;
  session: WorkspaceSession;
  instrument: TradeCycleInstrument;
  sessionConfig: SessionConfig;
  instrumentClasses: InstrumentClass[];
  strategyContext: SessionStrategyContext;
  toolContext: ToolBuildContext;
  services: CyclePlanServices;
  runPhasePlan: <TOutput>(
    phase: PipelinePhase,
    input: Record<string, unknown>,
  ) => Promise<PhasePlanRunResult<TOutput>>;
}

export type CycleStepRunner = <T>(
  stage: ExecutionStage,
  execute: () => Promise<T>,
) => Promise<T>;

export interface CyclePlanStage<TState> {
  id: string;
  executionStage?: ExecutionStage;
  required: boolean;
  failurePolicy?: StageFailurePolicy;
  execute(ctx: CyclePlanRunContext, state: TState): Promise<TState>;
}

export interface CyclePlanInspectMetadata {
  stageIds: readonly string[];
  phaseStages: readonly PipelinePhase[];
  engineStages: readonly string[];
}

export interface CyclePlan<TState> {
  id: string;
  initialState(ctx: CyclePlanRunContext, seed?: Partial<TState>): TState;
  stages: readonly CyclePlanStage<TState>[];
  inspect: CyclePlanInspectMetadata;
}

export class CyclePausedError extends Error {
  readonly name = "CyclePausedError";
}

export class CycleStageFailedError extends Error {
  readonly name = "CycleStageFailedError";

  constructor(
    readonly stage: ExecutionStage,
    readonly errorMessage: string,
  ) {
    super(`${stage} failed: ${errorMessage}`);
  }
}
