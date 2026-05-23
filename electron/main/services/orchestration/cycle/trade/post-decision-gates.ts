import type { InstrumentAnalysisServices } from "../../../pipeline/analysis/services";
import type { EngineRunCtx } from "../../../pipeline/execution/input-builder-registry";
import type {
  TradeCycleInstrument,
  InstrumentAnalysisState,
} from "../../../pipeline/analysis/types";
import { runEngineChainStage } from "../../../pipeline/execution/stage-dispatch";
import { DEFAULT_TRADE_CYCLE_STAGES } from "../../../pipeline/implementations/trade/default-analysis-steps";
import type { TradingCycleContext } from "../trading-cycle-context";

const riskGateStage = DEFAULT_TRADE_CYCLE_STAGES.find(
  (s) => s.id === "risk_gate",
);
if (!riskGateStage || riskGateStage.kind !== "engine-chain") {
  throw new Error("risk_gate stage missing from DEFAULT_TRADE_CYCLE_STAGES");
}
const RISK_GATE_ENGINES = riskGateStage.engines;

export async function runPostDecisionGates(
  ctx: TradingCycleContext,
  instrument: TradeCycleInstrument,
  state: InstrumentAnalysisState,
  cycleId: string,
  tradeId: string | null,
): Promise<InstrumentAnalysisState> {
  const engineCtx: EngineRunCtx = {
    sessionId: ctx.sessionId,
    cycleId,
    tradeId,
    instrument,
    sessionConfig: ctx.getSessionConfig(),
    instrumentClasses: [],
    strategyContext: ctx.deps.strategyContextService.get(ctx.sessionId),
    services: ctx.deps as InstrumentAnalysisServices,
  };
  return runEngineChainStage(RISK_GATE_ENGINES, engineCtx, state);
}
