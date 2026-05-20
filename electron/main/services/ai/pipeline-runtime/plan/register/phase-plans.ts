import { registerCachePolicy } from "../registry/cache-policy-registry";
import { SELECTOR_INSTRUMENT_CACHE_POLICY } from "../cache/selector-instrument-cache";
import { registerInputBuilder } from "../registry/input-builder-registry";
import { brokerCoverageInputBuilder } from "../input-builders/broker-coverage";
import { predictionMarketCandidatesInputBuilder } from "../input-builders/prediction-market-candidates";
import { selectorScopeInputBuilder } from "../input-builders/selector-scope";
import { registerPhasePlan } from "../phase/registry";
import { registerUnifiedPlanRef } from "../unified/registry";
import { SELECTOR_PLAN } from "../plans/selector/plan";
import { registerTradeAnalysisPhasePlans } from "../plans/trade/analysis-plans";

export function registerDefaultPhasePlans(): void {
  registerInputBuilder(selectorScopeInputBuilder);
  registerInputBuilder(brokerCoverageInputBuilder);
  registerInputBuilder(predictionMarketCandidatesInputBuilder);

  registerCachePolicy(SELECTOR_INSTRUMENT_CACHE_POLICY);

  registerPhasePlan(SELECTOR_PLAN);
  registerUnifiedPlanRef("selector");

  registerTradeAnalysisPhasePlans();
  for (const phase of ["technical", "fundamental", "review", "decision"] as const) {
    registerUnifiedPlanRef(phase);
  }
}
