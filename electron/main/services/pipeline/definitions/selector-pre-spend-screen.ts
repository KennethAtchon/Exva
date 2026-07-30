import type { FailureHistoryEntry } from "../../orchestration/cycle/runtime-outcome";
import { SelectorRiskFilter } from "../../signals/scoring/selector-risk-filter";
import type { SelectorCandidate } from "../../signals/scoring/selector-candidate-merger";
import type { InstrumentClass } from "@/lib/types";
import type { SessionStrategyContext } from "@electron/shared/domain";
import type { BrokerRoutingService } from "../../broker/broker-routing-service";

export interface SelectorPreSpendScreenInput {
  sessionId: string;
  instrumentClasses: InstrumentClass[];
  strategyContext: SessionStrategyContext;
  brokerRouting?: BrokerRoutingService;
  failureHistory?: FailureHistoryEntry[];
  candidates: SelectorCandidate[];
}

/** Deterministic reject before paid verification workers (Solution 07). */
export function screenSelectorCandidatesBeforeVerification(
  input: SelectorPreSpendScreenInput,
): {
  passed: SelectorCandidate[];
  rejected: Array<{ symbol: string; reasons: string[] }>;
} {
  const filter = new SelectorRiskFilter({
    sessionId: input.sessionId,
    instrumentClasses: input.instrumentClasses,
    strategyContext: input.strategyContext,
    brokerRouting: input.brokerRouting,
    failureHistory: input.failureHistory,
  });
  const { accepted, rejected } = filter.evaluate(input.candidates);
  return {
    passed: accepted,
    rejected: rejected.map((row) => ({
      symbol: row.symbol,
      reasons: row.reasons,
    })),
  };
}
