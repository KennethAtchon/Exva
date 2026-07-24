import { StrategyDefinitionRegistry } from "./strategy-definition-registry";
import { breakoutDefinition } from "./definitions/breakout";
import { meanReversionDefinition } from "./definitions/mean-reversion";
import { optionsFlowDefinition } from "./definitions/options-flow";
import { trendFollowingDefinition } from "./definitions/trend-following";
import { unusualVolumeDefinition } from "./definitions/unusual-volume";
import { crossVenueDislocationDefinition } from "./definitions/cross-venue-dislocation";
import { fundingBasisDefinition } from "./definitions/funding-basis";
import { form4InsiderClusterDefinition } from "./definitions/form4-insider-cluster";
import { nyRangeBreakoutDefinition } from "./definitions/ny-range-breakout";

let registry: StrategyDefinitionRegistry | null = null;

export function getStrategyDefinitionRegistry(): StrategyDefinitionRegistry {
  if (!registry) {
    registry = new StrategyDefinitionRegistry();
    registry.register(meanReversionDefinition);
    registry.register(breakoutDefinition);
    registry.register(trendFollowingDefinition);
    registry.register(optionsFlowDefinition);
    registry.register(unusualVolumeDefinition);
    registry.register(crossVenueDislocationDefinition);
    registry.register(fundingBasisDefinition);
    registry.register(form4InsiderClusterDefinition);
    registry.register(nyRangeBreakoutDefinition);
  }
  return registry;
}

export type { StrategyDefinition } from "./strategy-definition-registry";
export { StrategyDefinitionRegistry } from "./strategy-definition-registry";
