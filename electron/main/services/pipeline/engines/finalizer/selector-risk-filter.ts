import {
  selectorEvidenceSchema,
  type SelectorEvidence,
} from "@electron/shared/ai/selector-candidate";
import { SelectorRiskFilter } from "../../../signal/scoring/selector-risk-filter";
import type { SelectorCandidate } from "../../../signal/scoring/selector-candidate-merger";
import { registerEngine, type FinalizerEngine } from "../registry";
import type { SelectorPlanState } from "../../definitions/selector.phase";
import type { FailureHistoryEntry } from "../../../orchestration/cycle/runtime-outcome";

export type SelectorRiskFilterFinalizerResult = ReturnType<
  SelectorRiskFilter["evaluate"]
> & {
  discoveredCount: number;
  verifiedCount: number;
};

function buildSelectorEvidence(candidate: SelectorCandidate): SelectorEvidence {
  const summary = candidate.rationale ?? candidate.catalystSummary ?? null;
  const toolNames = new Set(
    candidate.selectorTraces.flatMap((step) =>
      step.toolCalls.map((call) => call.tool),
    ),
  );
  return selectorEvidenceSchema.parse({
    summary,
    thesisDirection: inferThesisDirection(summary),
    sourceWorkers: candidate.source,
    riskFlags: candidate.riskFlags,
    hasQuoteEvidence: toolNames.has("get_quote"),
    hasNewsEvidence: toolNames.has("get_news"),
    hasSearchEvidence:
      toolNames.has("search_web") || toolNames.has("search_reddit"),
    hasOhlcvEvidence: toolNames.has("get_ohlcv"),
    hasFetchEvidence: toolNames.has("fetch_url"),
  });
}

function inferThesisDirection(
  summary: string | null,
): SelectorEvidence["thesisDirection"] {
  if (!summary) return "neutral";
  const text = summary.toLowerCase();
  if (/bearish|downtrend|selloff|breakdown|short setup/.test(text)) {
    return "short";
  }
  if (/bullish|uptrend|breakout|long setup|momentum/.test(text)) return "long";
  return "neutral";
}

const selectorRiskFilterEngine: FinalizerEngine<
  SelectorPlanState,
  SelectorRiskFilterFinalizerResult
> = {
  id: "selector-risk-filter",
  kind: "finalizer",
  async run(ctx, state) {
    const withEvidence = state.verifiedCandidates.map((candidate) => ({
      ...candidate,
      selectorEvidence: buildSelectorEvidence(candidate),
    }));
    const failureHistory = (
      (ctx.input.failureHistory as FailureHistoryEntry[] | undefined) ?? []
    ).filter((entry) => entry.instrumentSymbol != null);
    const evaluation = new SelectorRiskFilter({
      sessionId: ctx.sessionId,
      instrumentClasses: ctx.instrumentClasses,
      strategyContext: ctx.strategyContext,
      brokerRouting: ctx.toolContext.brokerRouting,
      failureHistory,
    }).evaluate(withEvidence);

    return {
      ...evaluation,
      discoveredCount: state.candidatesForVerification.length,
      verifiedCount: state.verifiedCandidates.length,
    };
  },
};

registerEngine(selectorRiskFilterEngine);
