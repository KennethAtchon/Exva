/**
 * Backtest-first stubs for future filing-driven signal classes (TODO §6).
 * Each type defines a research record shape and a minimal eligibility check.
 */

export type FutureFilingSignalKind =
  | "form_13d_activist"
  | "form_13g_passive"
  | "form_4_insider"
  | "earnings_preannouncement"
  | "buyback_authorization"
  | "secondary_offering"
  | "analyst_cluster";

export type FutureFilingSignalRecord = {
  kind: FutureFilingSignalKind;
  accessionNumber: string;
  ticker: string;
  filedAt: string;
  headline?: string;
  metadata?: Record<string, unknown>;
};

export const FUTURE_FILING_SIGNAL_KINDS: FutureFilingSignalKind[] = [
  "form_13d_activist",
  "form_13g_passive",
  "form_4_insider",
  "earnings_preannouncement",
  "buyback_authorization",
  "secondary_offering",
  "analyst_cluster",
];

/** Placeholder eligibility — extend when deterministic ingest exists. */
export function isFutureFilingSignalEligible(
  record: FutureFilingSignalRecord,
): boolean {
  if (!record.ticker.trim() || !record.accessionNumber.trim()) return false;
  if (record.kind === "analyst_cluster") {
    return record.metadata?.deterministicSource === true;
  }
  return true;
}

export function groupFutureSignalsByKind(
  records: FutureFilingSignalRecord[],
): Record<FutureFilingSignalKind, FutureFilingSignalRecord[]> {
  const grouped = Object.fromEntries(
    FUTURE_FILING_SIGNAL_KINDS.map((kind) => [
      kind,
      [] as FutureFilingSignalRecord[],
    ]),
  ) as Record<FutureFilingSignalKind, FutureFilingSignalRecord[]>;
  for (const record of records) {
    if (!isFutureFilingSignalEligible(record)) continue;
    grouped[record.kind].push(record);
  }
  return grouped;
}
