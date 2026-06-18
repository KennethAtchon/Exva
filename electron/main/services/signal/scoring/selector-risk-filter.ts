import type { ToolLLMToolStepTrace } from "../../orchestration/policy/candidate-validation-service";
import { CandidateValidationService } from "../../orchestration/policy/candidate-validation-service";
import type { CandidateRejection } from "@electron/shared/ai/selector-diagnostics";
import { collectCandidateToolNames } from "@electron/shared/ai/selector-diagnostics";
import type { InstrumentClass } from "@/lib/types";
import type { SessionStrategyContext } from "@electron/shared/domain";
import type { BrokerRoutingService } from "../../broker/broker-routing-service";
import {
  DEFAULT_RISK_RULE_SET,
  type RiskRuleSet,
} from "@electron/shared/ai/ai-phase-config";
import type { SelectorCandidate } from "./selector-candidate-merger";
import type { FailureHistoryEntry } from "../../orchestration/cycle/runtime-outcome";

export interface SelectorSelectorRiskFilterDeps {
  sessionId: string;
  instrumentClasses: InstrumentClass[];
  strategyContext: SessionStrategyContext;
  brokerRouting?: BrokerRoutingService;
  riskRules?: RiskRuleSet;
  failureHistory?: FailureHistoryEntry[];
}

export interface SelectorSelectorRiskFilterResult {
  accepted: SelectorCandidate[];
  rejected: CandidateRejection[];
}

export class SelectorRiskFilter {
  private readonly validator = new CandidateValidationService();

  constructor(private readonly deps: SelectorSelectorRiskFilterDeps) {}

  filter(candidates: SelectorCandidate[]): SelectorCandidate[] {
    return this.evaluate(candidates).accepted;
  }

  evaluate(candidates: SelectorCandidate[]): SelectorSelectorRiskFilterResult {
    const accepted: SelectorCandidate[] = [];
    const rejected: CandidateRejection[] = [];

    for (const candidate of candidates) {
      const toolNamesUsed = collectCandidateToolNames(candidate.selectorTraces);
      const reasons = this.collectRejectionReasons(candidate);
      if (reasons.length === 0) {
        accepted.push(candidate);
      } else {
        rejected.push({
          symbol: candidate.symbol,
          instrumentClass: candidate.instrumentClass,
          finalScore: candidate.finalScore,
          sourceWorkers: candidate.source,
          toolNamesUsed,
          reasons,
        });
      }
    }

    return { accepted, rejected };
  }

  private collectRejectionReasons(candidate: SelectorCandidate): string[] {
    const reasons: string[] = [];

    if (!this.deps.instrumentClasses.includes(candidate.instrumentClass)) {
      reasons.push(
        `Instrument class '${candidate.instrumentClass}' not enabled for session`,
      );
    }

    const minFinalScore =
      this.deps.riskRules?.minFinalScore ?? DEFAULT_RISK_RULE_SET.minFinalScore;
    if ((candidate.finalScore ?? 0) < minFinalScore) {
      reasons.push(
        `Final score ${candidate.finalScore ?? 0} below minimum ${minFinalScore}`,
      );
    }

    if (!candidate.rationale?.trim()) {
      reasons.push("Selector rationale is empty");
    }

    const recentFailure = this.deps.failureHistory?.find(
      (entry) =>
        entry.instrumentSymbol === candidate.symbol &&
        entry.instrumentClass === candidate.instrumentClass,
    );
    if (
      recentFailure?.retryAt &&
      Date.parse(recentFailure.retryAt) > Date.now()
    ) {
      reasons.push(
        `Recent ${recentFailure.outcome} at ${recentFailure.stage}; retry after ${recentFailure.retryAt}`,
      );
    }

    if (this.deps.brokerRouting) {
      try {
        this.deps.brokerRouting.resolveBrokerAccountId(
          this.deps.sessionId,
          candidate.instrumentClass,
        );
      } catch {
        reasons.push("No broker account supports this instrument class");
      }
    }

    const quoteSnapshot = extractQuoteSnapshot(candidate.selectorTraces);
    if (!quoteSnapshot) {
      reasons.push("Missing get_quote trace or valid quote snapshot");
      return reasons;
    }

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
      // The risk filter only ever evaluates researcher-discovered candidates;
      // entry-engine-supplied instruments never reach this stage.
      selectionSource: "ai_picker",
      selectorTrace: candidate.selectorTraces as ToolLLMToolStepTrace[],
      quoteSnapshot,
    });

    if (!validation.allowed) {
      reasons.push(...validation.reasons);
    }

    return reasons;
  }
}

function extractQuoteSnapshot(
  traces: SelectorCandidate["selectorTraces"],
): import("../../broker/adapters/broker-adapter").MarketSnapshot | null {
  for (const trace of traces) {
    for (const call of trace.toolCalls) {
      if (call.tool !== "get_quote") continue;
      try {
        const parsed = JSON.parse(call.resultJson) as Record<string, unknown>;
        if (
          typeof parsed.price !== "number" ||
          typeof parsed.timestamp !== "string"
        )
          continue;
        return {
          instrumentSymbol:
            typeof parsed.instrumentSymbol === "string"
              ? parsed.instrumentSymbol
              : "",
          price: parsed.price,
          bid: typeof parsed.bid === "number" ? parsed.bid : undefined,
          ask: typeof parsed.ask === "number" ? parsed.ask : undefined,
          spreadPct:
            typeof parsed.spreadPct === "number" ? parsed.spreadPct : undefined,
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
