import { z } from "zod";
import { registerAllPhases } from "../definitions";
import { registerAllPipelineWorkers } from "../register-all-workers";
import { registerDefaultInstrumentAnalyses } from "../implementations/registry/register-analyses";
import { registerSignalEngine } from "../../signal/registry/signal-engine-registry";
import { registerTradeSignalEngines } from "../../signal/registry/register-trade-signal-engines";

let booted = false;

function registerMinimalSignalEngines(): void {
  registerTradeSignalEngines();
  registerSignalEngine({
    id: "risk-summary",
    kind: "context",
    inputSchema: z.any(),
    outputSchema: z.any(),
    run: () => ({}),
  });
}

/** Idempotent boot helper for pipeline integration tests. */
export function ensurePipelineBootRegistered(): void {
  if (booted) return;
  registerAllPipelineWorkers();
  registerAllPhases();
  registerMinimalSignalEngines();
  try {
    registerDefaultInstrumentAnalyses();
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !/already registered/i.test(error.message)
    ) {
      throw error;
    }
  }
  booted = true;
}
