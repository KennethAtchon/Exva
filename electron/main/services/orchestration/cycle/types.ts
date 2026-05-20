import type { InstrumentClass, Trade } from "@/lib/types";
import type { SelectorEvidence } from "@electron/shared/ai/selector-pipeline-candidate";
import type { AgentResult } from "../../ai/ai-runtime/ai-runtime-types";
import type {
  TechnicalSignal,
  FundamentalSignal,
  ReviewSignal,
  TradeSignal,
} from "@electron/shared/ai/pipeline-signals";
import type { ToolStepTrace } from "../policy/candidate-validation-service";

export type ResolvedInstrument = {
  symbol: string;
  instrumentClass: InstrumentClass;
  instrumentDisplayName?: string;
  predictionOutcome?: "YES" | "NO" | null;
  instrumentMetadataJson?: string | null;
  selectorEvidence?: SelectorEvidence | null;
  selectorTraces?: ToolStepTrace[];
};

export type AiTechnicalRun = AgentResult<TechnicalSignal>;
export type AiFundamentalRun = AgentResult<FundamentalSignal>;
export type AiReviewRun = AgentResult<ReviewSignal>;
export type AiDecisionRun = AgentResult<TradeSignal>;

export type AiPipelineResult = {
  technical: AiTechnicalRun;
  fundamental: AiFundamentalRun;
  review: AiReviewRun;
  decision: AiDecisionRun;
};

export type PredictionToken = { outcome?: unknown; token_id?: unknown };

export type SelectorCycleContext = {
  kind: "selector";
  cycleId: string;
  label: string;
};

export type TradeCycleContext = {
  kind: "trade";
  cycleId: string;
  instrument: ResolvedInstrument;
  technical?: AiTechnicalRun;
  fundamental?: AiFundamentalRun;
  review?: AiReviewRun;
  decision?: AiDecisionRun;
  trade?: Trade;
  riskOrder?: import("../../broker/adapters/broker-adapter").OrderRequest;
};

export type CycleContext = SelectorCycleContext | TradeCycleContext;

export const DEFAULT_SELECTOR_NO_INSTRUMENT_RETRY_MINUTES = 5;
export const SELECTOR_NO_INSTRUMENT_RETRY_MINUTES_MIN = 1;
export const SELECTOR_NO_INSTRUMENT_RETRY_MINUTES_MAX = 60;
