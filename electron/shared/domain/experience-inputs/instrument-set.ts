import type { InstrumentClass } from "@electron/shared/domain/enums";

// ---------------------------------------------------------------------------
// Member contracts
// ---------------------------------------------------------------------------

/**
 * The authoritative shape stored in the database for an instrument-set member.
 * `canonicalId` is the normalized identity used for deduplication and
 * cross-provider resolution.
 */
export interface InstrumentSetMemberRecord {
  setId: string;
  setRevision: number;
  canonicalId: string;
  displaySymbol: string;
  instrumentClass: InstrumentClass;
  venue: string | null;
  /** ISO-8601 timestamp at which this member was added to the revision. */
  addedAt: string;
  /** Optional human note explaining why the member is in this set. */
  note: string | null;
}

/**
 * Lightweight member reference used inside `InstrumentSetRevision.members`.
 * Does not repeat setId/revision — those come from the parent.
 */
export interface InstrumentSetMemberRef {
  canonicalId: string;
  displaySymbol: string;
  venue: string | null;
}

// ---------------------------------------------------------------------------
// canonicalizeInstrumentId (V1)
// ---------------------------------------------------------------------------

/**
 * Produce the canonical instrument identity for deduplication and cross-check.
 *
 * V1 rules:
 * - All classes: trim surrounding whitespace.
 * - `stock` and `futures`: uppercase the result.
 * - `crypto`: uppercase the result (e.g. "btc-usd" → "BTC-USD").
 * - `options` and `prediction_market`: uppercase the result.
 *
 * The "keep crypto as-is" note in the plan refers to _structure_ (e.g.
 * preserving the dash separator in "BTC-USD" rather than turning it into
 * "BTCUSD"), not to case — crypto symbols are still uppercased for
 * consistent key comparison.
 *
 * Throws on empty input after trimming.
 */
export function canonicalizeInstrumentId(
  raw: string,
  _instrumentClass: InstrumentClass,
): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new Error(
      "canonicalizeInstrumentId: instrument id must not be empty after trimming",
    );
  }
  // V1: uppercase for all classes; crypto preserves separator structure.
  return trimmed.toUpperCase();
}

/**
 * Return true when `candidateId` matches `referenceId` after both are
 * canonicalized. Convenient for membership checks without pre-normalizing.
 */
export function instrumentIdsMatch(
  candidateId: string,
  referenceId: string,
  instrumentClass: InstrumentClass,
): boolean {
  return (
    canonicalizeInstrumentId(candidateId, instrumentClass) ===
    canonicalizeInstrumentId(referenceId, instrumentClass)
  );
}
