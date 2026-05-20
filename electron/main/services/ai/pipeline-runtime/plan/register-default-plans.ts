import { registerCachePolicy } from "./cache-policy-registry";
import { SELECTOR_INSTRUMENT_CACHE_POLICY } from "./cache/selector-instrument-cache";
import { registerInputBuilder } from "./input-builder-registry";
import { brokerCoverageInputBuilder } from "./input-builders/broker-coverage";
import { predictionMarketCandidatesInputBuilder } from "./input-builders/prediction-market-candidates";
import { selectorScopeInputBuilder } from "./input-builders/selector-scope";
import { registerPhasePlan } from "./phase-plan-registry";
import { SELECTOR_PLAN } from "./plans/selector-plan";

export function registerDefaultPhasePlans(): void {
  registerInputBuilder(selectorScopeInputBuilder);
  registerInputBuilder(brokerCoverageInputBuilder);
  registerInputBuilder(predictionMarketCandidatesInputBuilder);

  registerCachePolicy(SELECTOR_INSTRUMENT_CACHE_POLICY);

  registerPhasePlan(SELECTOR_PLAN);
}
