import type { InstrumentClass, Trade } from "@/lib/types";
import type { SelectorEvidence } from "@electron/shared/ai/selector-candidate";
import type { LLMRunResult } from "../../llm/llm-types";
import type {
  TechnicalSignal,
  FundamentalSignal,
  ReviewSignal,
  TradeSignal,
} from "@electron/shared/ai/trade-signals";
import type { ToolLLMToolStepTrace } from "../policy/candidate-validation-service";
import type { FailureHistoryEntry } from "./runtime-outcome";
import type { SignalSourceType } from "@electron/shared/domain";

export type ResolvedInstrument = {
  symbol: string;
  instrumentClass: InstrumentClass;
  instrumentDisplayName?: string;
  predictionOutcome?: "YES" | "NO" | null;
  instrumentMetadataJson?: string | null;
  selectorEvidence?: SelectorEvidence | null;
  selectorTraces?: ToolLLMToolStepTrace[];
  recentFailureHistory?: FailureHistoryEntry[];
};

type AiTechnicalRun = LLMRunResult<TechnicalSignal>;
type AiFundamentalRun = LLMRunResult<FundamentalSignal>;
type AiReviewRun = LLMRunResult<ReviewSignal>;
type AiDecisionRun = LLMRunResult<TradeSignal>;

export type SelectorCycleContext = {
  kind: "selector";
  cycleId: string;
  label: string;
  signalTrigger?: {
    deliveryId: string;
    signalId: string;
    sourceType: SignalSourceType;
    ticker: string;
    companyName: string | null;
    documentUrl: string | null;
    accessionNumber: string | null;
    payloadJson: Record<string, unknown>;
  } | null;
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
