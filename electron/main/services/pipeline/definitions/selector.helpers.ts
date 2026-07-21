/**
 * Stage-local helper functions for the selector phase.
 *
 * These are used inside AIWorkerBatch.applyResults() — which is exempt from the
 * engine registry rule — and in the selector finalizer engines. They must NOT be
 * called from phase-level hooks (input, entry, cache, finalize).
 *
 * parseWorkerToolTrace is shared with selector-submission-builder, which needs
 * it to summarize per-worker tool coverage in the phase output diagnostics.
 */

import type { WorkerDefinition } from "@electron/shared/ai/ai-phase";
import { DEFAULT_SCORING_WEIGHTS } from "@electron/shared/ai/ai-phase-config";
import type { LLMRunResult } from "../../llm/llm-types";
import {
  mergeDiscoveryCandidates,
  candidateIdentityKey,
  type SelectorCandidate,
} from "../../signals/scoring/selector-candidate-merger";
export type { SelectorCandidate };
import { scoreCandidate } from "../../signals/scoring/selector-scoring-engine";
import { safeJsonParse } from "../../infra/safe-json-parse";
import { verificationOutputSchema } from "./selector.schemas";
import type { z } from "zod";

type VerificationOutput = z.infer<typeof verificationOutputSchema>;

export function parseWorkerToolTrace(
  raw: string | null,
): SelectorCandidate["selectorTraces"] {
  if (!raw) return [];
  const parsed = safeJsonParse<
    Array<{
      step: number;
      toolCalls?: Array<{
        step: number;
        tool: string;
        argsJson: string;
        resultJson: string;
      }>;
    }>
  >(raw);
  if (!Array.isArray(parsed)) return [];
  return parsed.map((step) => ({
    step: step.step,
    toolCalls: step.toolCalls ?? [],
  }));
}

function maxNullable(a: number | null, b: number | null): number | null {
  if (a == null) return b;
  if (b == null) return a;
  return Math.max(a, b);
}

export function scoreSelectorCandidates(
  candidates: SelectorCandidate[],
): SelectorCandidate[] {
  return candidates
    .map((c) => ({
      ...c,
      finalScore: scoreCandidate(c, DEFAULT_SCORING_WEIGHTS),
    }))
    .sort((a, b) => (b.finalScore ?? 0) - (a.finalScore ?? 0));
}

export function applyDiscoveryResults(
  results: Array<{ worker: WorkerDefinition; result: LLMRunResult<unknown> }>,
): SelectorCandidate[] {
  const raw = results.map(({ worker, result }) =>
    (result.output as { candidates: SelectorCandidate[] }).candidates.map(
      (candidate): SelectorCandidate => ({
        ...candidate,
        finalScore: null,
        source: [...candidate.source, worker.id],
        selectorEvidence: null,
        selectorTraces: parseWorkerToolTrace(result.message.tool_calls_json),
      }),
    ),
  );
  return mergeDiscoveryCandidates(raw);
}

/** Strip the verification worker prefix to recover candidateIdentityKey. */
export function parseVerificationWorkerIdentity(workerId: string): string {
  return workerId.replace(
    /^(market-validator|catalyst-extractor|liquidity-gate):/,
    "",
  );
}

export function applyVerificationResults(
  candidates: SelectorCandidate[],
  results: Array<{
    worker: WorkerDefinition;
    result: LLMRunResult<VerificationOutput>;
  }>,
): SelectorCandidate[] {
  const merged = new Map(
    candidates.map((c) => [candidateIdentityKey(c), { ...c }]),
  );
  for (const { worker, result } of results) {
    // Key off the worker id (encodes discovery identity), not the model echo —
    // verifiers often omit predictionOutcome and would miss the merge.
    const key = parseVerificationWorkerIdentity(worker.id);
    const candidate = merged.get(key);
    if (!candidate) continue;
    candidate.instrumentDisplayName =
      candidate.instrumentDisplayName ??
      result.output.candidate.instrumentDisplayName ??
      null;
    candidate.predictionOutcome =
      candidate.predictionOutcome ??
      result.output.candidate.predictionOutcome ??
      null;
    candidate.instrumentMetadataJson =
      candidate.instrumentMetadataJson ??
      result.output.candidate.instrumentMetadataJson ??
      null;
    candidate.volumeScore = maxNullable(
      candidate.volumeScore,
      result.output.candidate.volumeScore ?? null,
    );
    candidate.liquidityScore = maxNullable(
      candidate.liquidityScore,
      result.output.candidate.liquidityScore ?? null,
    );
    candidate.catalystScore = maxNullable(
      candidate.catalystScore,
      result.output.candidate.catalystScore ?? null,
    );
    candidate.catalystSummary =
      candidate.catalystSummary ??
      result.output.candidate.catalystSummary ??
      null;
    candidate.rationale =
      candidate.rationale ?? result.output.candidate.rationale ?? null;
    candidate.selectorTraces.push(
      ...parseWorkerToolTrace(result.message.tool_calls_json),
    );
    const baseWorkerId = worker.id.split(":")[0] ?? worker.id;
    if (!candidate.source.includes(baseWorkerId)) {
      candidate.source.push(baseWorkerId);
    }
  }
  return [...merged.values()];
}

/**
 * Extracts diagnostic fields from selector output for structured logging.
 * Used as the SELECTOR_PHASE.summarize function.
 */
export function summarizeSelectorOutput(
  output: unknown,
): Record<string, unknown> {
  if (!output || typeof output !== "object") return {};
  const diagnostics = (output as { diagnostics?: unknown }).diagnostics;
  if (!diagnostics || typeof diagnostics !== "object") return {};
  const row = diagnostics as {
    acceptedCount?: number;
    rejected?: Array<{ symbol?: string; reasons?: string[] }>;
  };
  return {
    acceptedCount: row.acceptedCount ?? null,
    rejectedCount: row.rejected?.length ?? null,
    rejectionReasons:
      row.rejected?.map((entry) => ({
        symbol: entry.symbol ?? null,
        reasons: entry.reasons ?? [],
      })) ?? null,
  };
}
