import type { CyclePlanServices } from "../../../pipeline/analysis/services";
import type { EngineRunCtx } from "../../../pipeline/execution/input-builder-registry";
import type {
  TradeCycleInstrument,
  TradeCyclePlanState,
} from "../../../pipeline/analysis/types";
import { runEngineChainStage } from "../../../pipeline/execution/stage-dispatch";
import { DEFAULT_TRADE_CYCLE_STAGES } from "../../../pipeline/implementations/trade/default-cycle-stages";
import type { OrchestratorContext } from "../orchestrator-context";

const riskGateStage = DEFAULT_TRADE_CYCLE_STAGES.find(
  (s) => s.id === "risk_gate",
);
if (!riskGateStage || riskGateStage.kind !== "engine-chain") {
  throw new Error("risk_gate stage missing from DEFAULT_TRADE_CYCLE_STAGES");
}
const RISK_GATE_ENGINES = riskGateStage.engines;

export async function runPostDecisionGates(
  ctx: OrchestratorContext,
  instrument: TradeCycleInstrument,
  state: TradeCyclePlanState,
  cycleId: string,
  tradeId: string | null,
): Promise<TradeCyclePlanState> {
  const engineCtx: EngineRunCtx = {
    sessionId: ctx.sessionId,
    cycleId,
    tradeId,
    instrument,
    sessionConfig: ctx.getSessionConfig(),
    instrumentClasses: [],
    strategyContext: ctx.deps.strategyContextService.get(ctx.sessionId),
    services: ctx.deps as CyclePlanServices,
  };
  return runEngineChainStage(RISK_GATE_ENGINES, engineCtx, state);
}
