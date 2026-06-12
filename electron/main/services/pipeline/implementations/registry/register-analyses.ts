import { registerSignalEngineInputBuilder } from "../../execution/input-builder-registry";
import { RULES_ENGINE_INPUT_BUILDERS } from "../inputs/rules-engine-input-builders";
import { TRADE_ENGINE_INPUT_BUILDERS } from "../inputs/trade-engine-input-builders";
import { registerPipeline, validatePipelineRegistry } from "./pipeline-router";
import { ALL_PIPELINES } from "./pipelines";
import "../../../experiences/index";

export function registerDefaultInstrumentAnalyses(): void {
  for (const builder of [
    ...TRADE_ENGINE_INPUT_BUILDERS,
    ...RULES_ENGINE_INPUT_BUILDERS,
  ]) {
    registerSignalEngineInputBuilder(builder);
  }
  for (const pipeline of ALL_PIPELINES) {
    registerPipeline(pipeline);
  }
  validatePipelineRegistry();
}
