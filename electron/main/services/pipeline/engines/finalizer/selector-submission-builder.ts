import type { InstrumentSelection } from "@/lib/schemas";
import type { Candidate } from "@electron/shared/ai/selector-candidate";
import { buildInstrumentSelection } from "../../../signals/scoring/selector-submission-builder";
import { fetchPredictionMarketCandidates } from "../../../signals/scoring/prediction-market-candidate-engine";
import { candidateIdentityKey } from "../../../signals/scoring/selector-candidate-merger";
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
    const accepted = await rehydratePredictionMetadata(
      evaluationResult.accepted,
      ctx.sessionId,
      ctx.services.brokerRouting,
    );
    return {
      ...buildInstrumentSelection(
        accepted,
        ctx.strategyContext.riskConfig.maxConcurrentTrades,
      ),
      diagnostics: {
        discoveredCount: evaluationResult.discoveredCount,
        verifiedCount: evaluationResult.verifiedCount,
        acceptedCount: accepted.length,
        rejected: evaluationResult.rejected,
        workerToolCoverage: buildWorkerToolCoverage(workerResults),
      },
    };
  },
};

/** Server-owned token metadata — never trust the model to reproduce token IDs. */
async function rehydratePredictionMetadata(
  candidates: Candidate[],
  sessionId: string,
  brokerRouting: Parameters<typeof fetchPredictionMarketCandidates>[1],
): Promise<Candidate[]> {
  if (
    !candidates.some(
      (candidate) => candidate.instrumentClass === "prediction_market",
    )
  ) {
    return candidates;
  }

  let authoritative: Awaited<
    ReturnType<typeof fetchPredictionMarketCandidates>
  >;
  try {
    authoritative = await fetchPredictionMarketCandidates(
      sessionId,
      brokerRouting,
    );
  } catch {
    return candidates;
  }

  const byKey = new Map(
    authoritative.map((row) => [
      candidateIdentityKey({
        instrumentClass: row.instrumentClass,
        symbol: row.symbol,
        predictionOutcome: row.predictionOutcome,
      }),
      row,
    ]),
  );

  return candidates.map((candidate) => {
    if (candidate.instrumentClass !== "prediction_market") return candidate;
    const auth = byKey.get(candidateIdentityKey(candidate));
    if (!auth) return candidate;
    return {
      ...candidate,
      instrumentDisplayName:
        candidate.instrumentDisplayName ?? auth.instrumentDisplayName ?? null,
      predictionOutcome:
        candidate.predictionOutcome ?? auth.predictionOutcome ?? null,
      instrumentMetadataJson:
        auth.instrumentMetadataJson ?? candidate.instrumentMetadataJson,
    };
  });
}

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
