import type { InstrumentClass } from "./enums";
import type { LabelBenchmark, LabelHorizon } from "./research-contract";

/** Action the engine took for an observed signal. */
export type ObservationAction = "buy" | "sell" | "skip";

/**
 * Point-in-time record of a single signal evaluation, traded or skipped (P3).
 */
export interface SignalObservation {
  id: string;
  sessionId: string | null;
  experienceId: string;
  signalId: string;
  cycleId: string | null;
  instrumentSymbol: string;
  instrumentClass: InstrumentClass;
  action: ObservationAction;
  eventTime: string;
  observedAt: string;
  sourceUri: string | null;
  featureJson: string;
  decisionJson: string | null;
  modelVersion: string | null;
  labelHorizon: LabelHorizon;
  labelBenchmark: LabelBenchmark;
  referencePrice: number | null;
  labelReadyAt: string | null;
  createdAt: string;
}

export interface SignalLabel {
  observationId: string;
  horizon: LabelHorizon;
  benchmark: LabelBenchmark;
  grossReturnBps: number | null;
  costBps: number | null;
  netReturnBps: number | null;
  benchmarkReturnBps: number | null;
  maxFavorableBps: number | null;
  maxAdverseBps: number | null;
  outcomeWin: number | null;
  labelReadyAt: string;
  createdAt: string;
}
