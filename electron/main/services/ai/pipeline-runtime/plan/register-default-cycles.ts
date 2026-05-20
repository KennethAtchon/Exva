import { registerCyclePlan } from "./cycle-plan-registry";
import { DEFAULT_TRADE_CYCLE } from "./plans/default-trade-cycle";

export function registerDefaultCyclePlans(): void {
  registerCyclePlan(DEFAULT_TRADE_CYCLE);
}
