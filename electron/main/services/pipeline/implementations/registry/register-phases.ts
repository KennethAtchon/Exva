import { registerCachePolicy } from "../registry/cache-policy-registry";
import { SELECTOR_INSTRUMENT_CACHE_POLICY } from "../cache/selector-instrument-cache";
import { registerInputBuilder } from "../registry/input-builder-registry";
import { brokerCoverageInputBuilder } from "../inputs/broker-coverage";
import { predictionMarketCandidatesInputBuilder } from "../inputs/prediction-market-candidates";
import { selectorScopeInputBuilder } from "../inputs/selector-scope";
import { registerAIPhase } from "../../phases/registry";
import { registerUnifiedPlanRef } from "./analysis-resolver";
import { SELECTOR_PLAN } from "../selector/selector-analysis";
import { registerTradeAnalysisAIPhases } from "../trade/phase-analyses";

export function registerDefaultAIPhases(): void {
  registerInputBuilder(selectorScopeInputBuilder);
  registerInputBuilder(brokerCoverageInputBuilder);
  registerInputBuilder(predictionMarketCandidatesInputBuilder);

  registerCachePolicy(SELECTOR_INSTRUMENT_CACHE_POLICY);

  registerAIPhase(SELECTOR_PLAN);
  registerUnifiedPlanRef("selector");

  registerTradeAnalysisAIPhases();
  for (const phase of [
    "technical",
    "fundamental",
    "review",
    "decision",
  ] as const) {
    registerUnifiedPlanRef(phase);
  }
}
