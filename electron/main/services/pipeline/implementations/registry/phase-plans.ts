import { registerCachePolicy } from "../registry/cache-policy-registry";
import { SELECTOR_INSTRUMENT_CACHE_POLICY } from "../cache/selector-instrument-cache";
import { registerInputBuilder } from "../registry/input-builder-registry";
import { brokerCoverageInputBuilder } from "../inputs/broker-coverage";
import { predictionMarketCandidatesInputBuilder } from "../inputs/prediction-market-candidates";
import { selectorScopeInputBuilder } from "../inputs/selector-scope";
import { registerPhasePlan } from "../../phases/registry";
import { registerUnifiedPlanRef } from "./registry";
import { SELECTOR_PLAN } from "../selector/plan";
import { registerTradeAnalysisPhasePlans } from "../trade/analysis-plans";

export function registerDefaultPhasePlans(): void {
  registerInputBuilder(selectorScopeInputBuilder);
  registerInputBuilder(brokerCoverageInputBuilder);
  registerInputBuilder(predictionMarketCandidatesInputBuilder);

  registerCachePolicy(SELECTOR_INSTRUMENT_CACHE_POLICY);

  registerPhasePlan(SELECTOR_PLAN);
  registerUnifiedPlanRef("selector");

  registerTradeAnalysisPhasePlans();
  for (const phase of [
    "technical",
    "fundamental",
    "review",
    "decision",
  ] as const) {
    registerUnifiedPlanRef(phase);
  }
}
