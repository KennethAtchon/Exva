import { registerEngineInputBuilder } from "../engine/input-builder-registry";
import { TRADE_ENGINE_INPUT_BUILDERS } from "../engine-input-builders/trade-engine-input-builders";
import { registerCyclePlan } from "../cycle/registry";
import { DEFAULT_TRADE_CYCLE } from "../plans/trade/default-cycle";

export function registerDefaultCyclePlans(): void {
  for (const builder of TRADE_ENGINE_INPUT_BUILDERS) {
    registerEngineInputBuilder(builder);
  }
  registerCyclePlan(DEFAULT_TRADE_CYCLE);
}
