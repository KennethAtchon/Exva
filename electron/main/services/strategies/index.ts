import { StrategyDefinitionRegistry } from "./strategy-definition-registry";
import { breakoutDefinition } from "./definitions/breakout";
import { meanReversionDefinition } from "./definitions/mean-reversion";
import { optionsFlowDefinition } from "./definitions/options-flow";
import { trendFollowingDefinition } from "./definitions/trend-following";

let registry: StrategyDefinitionRegistry | null = null;

export function getStrategyDefinitionRegistry(): StrategyDefinitionRegistry {
  if (!registry) {
    registry = new StrategyDefinitionRegistry();
    registry.register(meanReversionDefinition);
    registry.register(breakoutDefinition);
    registry.register(trendFollowingDefinition);
    registry.register(optionsFlowDefinition);
  }
  return registry;
}

export type { StrategyDefinition } from "./strategy-definition-registry";
export { StrategyDefinitionRegistry } from "./strategy-definition-registry";
