import type { InstrumentSelection } from "@/lib/schemas";
import { buildInstrumentSelection } from "../../../signal/scoring/selector-submission-builder";
import { parseWorkerToolTrace } from "../../definitions/selector.helpers";
import { summarizeWorkerToolCoverage } from "../../execution/worker-tool-requirements";
import {
  registerEngine,
  type FinalizerEngine,
  type PhaseWorkerResult,
} from "../registry";
import type { SelectorRiskFilterFinalizerResult } from "./selector-risk-filter";

const selectorSubmissionBuilderEngine: FinalizerEngine<
  SelectorRiskFilterFinalizerResult,
  InstrumentSelection
> = {
  id: "selector-submission-builder",
  kind: "finalizer",
  async run(ctx, evaluationResult, workerResults) {
    return {
      ...buildInstrumentSelection(
        evaluationResult.accepted,
        ctx.strategyContext.riskConfig.maxConcurrentTrades,
      ),
      diagnostics: {
        discoveredCount: evaluationResult.discoveredCount,
        verifiedCount: evaluationResult.verifiedCount,
        acceptedCount: evaluationResult.accepted.length,
        rejected: evaluationResult.rejected,
        workerToolCoverage: buildWorkerToolCoverage(workerResults),
      },
    };
  },
};

function buildWorkerToolCoverage(workerResults: PhaseWorkerResult[]) {
  return workerResults.map(({ worker, result }) => {
    const usedTools = parseWorkerToolNames(result.message.tool_calls_json);
    // toolRequirements is declared on the WorkerDefinition itself — use it directly.
    // No fallback string-map needed; if a worker has no declared requirements,
    // summarizeWorkerToolCoverage handles the undefined case.
    return summarizeWorkerToolCoverage(
      worker.id,
      worker.toolRequirements,
      usedTools,
    );
  });
}

function parseWorkerToolNames(raw: string | null): string[] {
  const steps = parseWorkerToolTrace(raw);
  return [
    ...new Set(
      steps.flatMap((step) => step.toolCalls.map((call) => call.tool)),
    ),
  ];
}

registerEngine(selectorSubmissionBuilderEngine);
