import type { Candidate } from "@electron/shared/ai/selector-pipeline-candidate";

export interface WorkingCandidate extends Candidate {
  selectorResearchBrief?: string | null;
  selectorTraces: Array<{
    step: number;
    toolCalls: Array<{ step: number; tool: string; argsJson: string; resultJson: string }>;
  }>;
}

export function mergeCandidates(groups: WorkingCandidate[][]): WorkingCandidate[] {
  const merged = new Map<string, WorkingCandidate>();

  for (const group of groups) {
    for (const candidate of group) {
      const key = `${candidate.instrumentClass}:${candidate.symbol}`;
      const current = merged.get(key);
      if (!current) {
        merged.set(key, {
          ...candidate,
          source: [...candidate.source],
          riskFlags: [...candidate.riskFlags],
          selectorTraces: [...candidate.selectorTraces],
        });
        continue;
      }

      current.instrumentDisplayName = current.instrumentDisplayName ?? candidate.instrumentDisplayName;
      current.hypeScore = maxNullable(current.hypeScore, candidate.hypeScore);
      current.volumeScore = maxNullable(current.volumeScore, candidate.volumeScore);
      current.catalystScore = maxNullable(current.catalystScore, candidate.catalystScore);
      current.liquidityScore = maxNullable(current.liquidityScore, candidate.liquidityScore);
      current.catalystSummary = current.catalystSummary ?? candidate.catalystSummary;
      current.rationale = current.rationale ?? candidate.rationale;
      current.selectorResearchBrief = current.selectorResearchBrief ?? candidate.selectorResearchBrief;
      current.source = [...new Set([...current.source, ...candidate.source])];
      current.riskFlags = [...new Set([...current.riskFlags, ...candidate.riskFlags])];
      current.selectorTraces.push(...candidate.selectorTraces);
    }
  }

  return [...merged.values()];
}

function maxNullable(a: number | null, b: number | null): number | null {
  if (a == null) return b;
  if (b == null) return a;
  return Math.max(a, b);
}
