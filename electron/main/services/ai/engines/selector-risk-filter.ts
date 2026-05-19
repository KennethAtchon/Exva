import type { ToolStepTrace } from "../../orchestration/candidate-validation-service";
import { CandidateValidationService } from "../../orchestration/candidate-validation-service";
import type { Candidate } from "@electron/shared/ai/selector-pipeline-candidate";
import type { InstrumentClass } from "@/lib/types";
import type { SessionStrategyContext } from "@electron/shared/domain";
import type { BrokerRoutingService } from "../../broker/broker-routing-service";
import { DEFAULT_RISK_RULE_SET, type RiskRuleSet } from "@electron/shared/ai/pipeline-config";
import type { WorkingCandidate } from "./selector-candidate-merger";

export interface RiskFilterDeps {
  sessionId: string;
  instrumentClasses: InstrumentClass[];
  strategyContext: SessionStrategyContext;
  brokerRouting?: BrokerRoutingService;
  riskRules?: RiskRuleSet;
}

export class RiskFilter {
  private readonly validator = new CandidateValidationService();

  constructor(private readonly deps: RiskFilterDeps) {}

  filter(candidates: WorkingCandidate[]): WorkingCandidate[] {
    return candidates.filter((candidate) => {
      if (!this.deps.instrumentClasses.includes(candidate.instrumentClass)) return false;
      const minFinalScore = this.deps.riskRules?.minFinalScore ?? DEFAULT_RISK_RULE_SET.minFinalScore;
      if ((candidate.finalScore ?? 0) < minFinalScore) return false;
      if (!candidate.rationale?.trim()) return false;
      if (this.deps.brokerRouting) {
        try {
          this.deps.brokerRouting.resolveBrokerAccountId(this.deps.sessionId, candidate.instrumentClass);
        } catch {
          return false;
        }
      }

      const quoteSnapshot = extractQuoteSnapshot(candidate.selectorTraces);
      if (!quoteSnapshot) return false;

      const validation = this.validator.validate({
        sessionId: this.deps.sessionId,
        cycleId: "selector",
        instrument: {
          symbol: candidate.symbol,
          instrumentClass: candidate.instrumentClass,
          selectorEvidence: candidate.selectorEvidence,
        },
        sessionInstrumentClasses: this.deps.instrumentClasses,
        brokerRouteAvailable: true,
        sideBias: this.deps.strategyContext.rules.sideBias,
        holdingStyle: this.deps.strategyContext.timeframe.holdingStyle,
        selectorTrace: candidate.selectorTraces as ToolStepTrace[],
        quoteSnapshot,
      });

      return validation.allowed;
    });
  }
}

function extractQuoteSnapshot(
  traces: WorkingCandidate["selectorTraces"],
): import("../../broker/adapters/broker-adapter").MarketSnapshot | null {
  for (const trace of traces) {
    for (const call of trace.toolCalls) {
      if (call.tool !== "get_quote") continue;
      try {
        const parsed = JSON.parse(call.resultJson) as Record<string, unknown>;
        if (typeof parsed.price !== "number" || typeof parsed.timestamp !== "string") continue;
        return {
          instrumentSymbol: typeof parsed.instrumentSymbol === "string" ? parsed.instrumentSymbol : "",
          price: parsed.price,
          bid: typeof parsed.bid === "number" ? parsed.bid : undefined,
          ask: typeof parsed.ask === "number" ? parsed.ask : undefined,
          spreadPct: typeof parsed.spreadPct === "number" ? parsed.spreadPct : undefined,
          volume: typeof parsed.volume === "number" ? parsed.volume : undefined,
          timestamp: parsed.timestamp,
        };
      } catch {
        continue;
      }
    }
  }
  return null;
}
