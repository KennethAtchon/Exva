import { registerEngineInputBuilder } from "../../execution/input-builder-registry";
import { TRADE_ENGINE_INPUT_BUILDERS } from "../inputs/trade-engine-input-builders";
import { registerCyclePlan } from "../../analysis/registry";
import { DEFAULT_TRADE_CYCLE } from "../trade/default-cycle";

export function registerDefaultCyclePlans(): void {
  for (const builder of TRADE_ENGINE_INPUT_BUILDERS) {
    registerEngineInputBuilder(builder);
  }
  registerCyclePlan(DEFAULT_TRADE_CYCLE);
}
