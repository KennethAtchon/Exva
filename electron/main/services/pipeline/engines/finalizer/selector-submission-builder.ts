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
    // Without authoritative discovery, only keep PM candidates that already
    // carry executable token metadata — never silently quote/order blind.
    return candidates.filter(isExecutableOrNonPrediction);
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

  const rehydrated: Candidate[] = [];
  for (const candidate of candidates) {
    if (candidate.instrumentClass !== "prediction_market") {
      rehydrated.push(candidate);
      continue;
    }

    const auth = byKey.get(candidateIdentityKey(candidate));
    if (!auth) {
      if (hasExecutablePredictionMetadata(candidate.instrumentMetadataJson)) {
        rehydrated.push(candidate);
      }
      continue;
    }

    rehydrated.push({
      ...candidate,
      instrumentDisplayName:
        candidate.instrumentDisplayName ?? auth.instrumentDisplayName ?? null,
      predictionOutcome:
        candidate.predictionOutcome ?? auth.predictionOutcome ?? null,
      instrumentMetadataJson:
        auth.instrumentMetadataJson ?? candidate.instrumentMetadataJson,
    });
  }
  return rehydrated;
}

function isExecutableOrNonPrediction(candidate: Candidate): boolean {
  return (
    candidate.instrumentClass !== "prediction_market" ||
    hasExecutablePredictionMetadata(candidate.instrumentMetadataJson)
  );
}

function hasExecutablePredictionMetadata(
  metadataJson: string | null | undefined,
): boolean {
  if (typeof metadataJson !== "string" || !metadataJson.trim()) return false;
  try {
    const parsed = JSON.parse(metadataJson) as {
      conditionId?: unknown;
      outcomeTokenId?: unknown;
    };
    return (
      typeof parsed.conditionId === "string" &&
      parsed.conditionId.length > 0 &&
      typeof parsed.outcomeTokenId === "string" &&
      parsed.outcomeTokenId.length > 0
    );
  } catch {
    return false;
  }
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
