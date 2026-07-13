import type {
  ExecutionStage,
  InstrumentClass,
  WorkspaceSession,
} from "@/lib/types";
import type { PipelinePhase } from "@electron/shared/ai/ai-phase";
import type { StageFailurePolicy } from "../execution/input-builder-registry";
import type { AIPhaseResult } from "../phases/types";
import type { SelectorEvidence } from "@electron/shared/ai/selector-candidate";
import type {
  FundamentalSignal,
  ReviewSignal,
  TechnicalSignal,
  TradeSignal,
} from "@electron/shared/ai/trade-signals";
import type { LLMRunResult } from "../../llm/llm-types";
import type { OrderRequest } from "../../broker/adapters/broker-adapter";
import type { TradeExecutionProfile } from "../../orchestration/trade-execution-profile";
import type { SessionStrategyContext } from "@electron/shared/domain";
import type { WorkerToolContext } from "../worker-tools/worker-tool-factory";
import type { InstrumentAnalysisServices } from "./services";
import type { ToolLLMToolStepTrace } from "../../orchestration/policy/candidate-validation-service";
import type { FailureHistoryEntry } from "../../orchestration/cycle/runtime-outcome";
import type { TradingStepResult } from "../../orchestration/cycle/trading-step-runner";

export type TradeCycleInstrument = {
  symbol: string;
  instrumentClass: InstrumentClass;
  instrumentDisplayName?: string;
  predictionOutcome?: "YES" | "NO" | null;
  instrumentMetadataJson?: string | null;
  selectorEvidence?: SelectorEvidence | null;
  selectorTraces?: ToolLLMToolStepTrace[];
  recentFailureHistory?: FailureHistoryEntry[];
};

type QuoteSnapshot = {
  price: number;
  timestamp: string;
};

type BrokerAllocationResult = {
  allocation: { ok: boolean; reason?: string; warning?: string };
  conflict: { ok: boolean; reason?: string };
};

export interface InstrumentAnalysisState {
  quoteSnapshot?: QuoteSnapshot;
  technical?: LLMRunResult<TechnicalSignal>;
  fundamental?: LLMRunResult<FundamentalSignal>;
  review?: LLMRunResult<ReviewSignal>;
  decision?: LLMRunResult<TradeSignal>;
  executionProfile?: TradeExecutionProfile;
  riskOrder?: OrderRequest;
  brokerAccountId?: string;
  brokerAllocation?: BrokerAllocationResult;
}

export interface InstrumentAnalysisResult {
  state: InstrumentAnalysisState;
  totalAiCostUsd: number;
}

export interface InstrumentAnalysisContext {
  cyclePlanId: string;
  sessionId: string;
  cycleId: string;
  tradeId: string | null;
  session: WorkspaceSession;
  instrument: TradeCycleInstrument;
  instrumentClasses: InstrumentClass[];
  strategyContext: SessionStrategyContext;
  toolContext: WorkerToolContext;
  services: InstrumentAnalysisServices;
  runAIPhase: <TOutput>(
    phase: PipelinePhase,
    input: Record<string, unknown>,
  ) => Promise<AIPhaseResult<TOutput>>;
}

export type AnalysisStepRunner = <T>(
  stage: ExecutionStage,
  execute: () => Promise<T>,
) => Promise<T>;

interface AnalysisStep<TState> {
  id: string;
  executionStage?: ExecutionStage;
  required: boolean;
  failurePolicy?: StageFailurePolicy;
  execute(ctx: InstrumentAnalysisContext, state: TState): Promise<TState>;
}

interface InstrumentAnalysisMetadata {
  stageIds: readonly string[];
  phaseStages: readonly PipelinePhase[];
  engineStages: readonly string[];
}

export interface InstrumentAnalysis<TState> {
  id: string;
  initialState(ctx: InstrumentAnalysisContext, seed?: Partial<TState>): TState;
  stages: readonly AnalysisStep<TState>[];
  inspect: InstrumentAnalysisMetadata;
}

export class AnalysisPausedError extends Error {
  readonly name = "AnalysisPausedError";
}

export class AnalysisStepFailedError extends Error {
  readonly name = "AnalysisStepFailedError";

  constructor(
    readonly stage: ExecutionStage,
    readonly result: Extract<TradingStepResult<unknown>, { ok: false }>,
  ) {
    super(`${stage} failed: ${result.errorMessage}`);
  }
}
