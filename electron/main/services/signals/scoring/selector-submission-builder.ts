import type { InstrumentSelection } from "@/lib/schemas";
import type { Candidate } from "@electron/shared/ai/selector-candidate";
import { safeJsonParse } from "../../infra/safe-json-parse";

export function buildInstrumentSelection(
  candidates: Candidate[],
  maxCount: number,
): InstrumentSelection {
  const top = candidates.slice(0, maxCount);
  return {
    instruments: top.map((candidate) => ({
      symbol: candidate.symbol,
      instrumentClass: candidate.instrumentClass,
      instrumentDisplayName: candidate.instrumentDisplayName ?? undefined,
      predictionOutcome: candidate.predictionOutcome ?? null,
      instrumentMetadataJson: mergeExecutableMetadata(
        candidate.instrumentMetadataJson,
        candidate.catalystSummary,
      ),
      rationale: candidate.rationale ?? candidate.catalystSummary ?? "",
      ...(candidate.selectorEvidence
        ? { selectorEvidence: candidate.selectorEvidence }
        : {}),
    })),
  };
}

/** Keep conditionId/outcomeTokenId; optionally attach catalyst text. */
function mergeExecutableMetadata(
  metadataJson: string | null | undefined,
  catalystSummary: string | null | undefined,
): string | undefined {
  const base =
    typeof metadataJson === "string" && metadataJson.trim()
      ? (safeJsonParse<Record<string, unknown>>(metadataJson) ?? {})
      : {};
  if (catalystSummary) {
    base.catalyst = catalystSummary;
  }
  if (Object.keys(base).length === 0) return undefined;
  return JSON.stringify(base);
}
