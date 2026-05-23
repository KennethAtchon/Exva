import type { CyclePlan, TradeCyclePlanState } from "../../analysis/types";
import {
  buildTradeCyclePlanStages,
  tradeCycleInspectMetadata,
} from "./default-cycle-stages";

export const DEFAULT_TRADE_CYCLE: CyclePlan<TradeCyclePlanState> = {
  id: "default-trade-cycle",
  initialState: (_ctx, seed = {}) => ({ ...seed }),
  inspect: tradeCycleInspectMetadata(),
  stages: buildTradeCyclePlanStages(),
};
