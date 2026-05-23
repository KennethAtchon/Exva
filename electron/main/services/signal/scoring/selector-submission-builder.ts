import type { InstrumentSelection } from "@/lib/schemas";
import type { Candidate } from "@electron/shared/ai/selector-pipeline-candidate";

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
      instrumentMetadataJson: candidate.catalystSummary
        ? JSON.stringify({ catalyst: candidate.catalystSummary })
        : undefined,
      rationale: candidate.rationale ?? candidate.catalystSummary ?? "",
      ...(candidate.selectorEvidence
        ? { selectorEvidence: candidate.selectorEvidence }
        : {}),
    })),
  };
}
