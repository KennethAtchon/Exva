import { registerSignalEngineInputBuilder } from "../../execution/input-builder-registry";
import { TRADE_ENGINE_INPUT_BUILDERS } from "../inputs/trade-engine-input-builders";
import { registerInstrumentAnalysis } from "../../analysis/registry";
import { DEFAULT_TRADE_CYCLE } from "../trade/default-analysis";

export function registerDefaultInstrumentAnalyses(): void {
  for (const builder of TRADE_ENGINE_INPUT_BUILDERS) {
    registerSignalEngineInputBuilder(builder);
  }
  registerInstrumentAnalysis(DEFAULT_TRADE_CYCLE);
}
