import type { InstrumentClass } from "@electron/shared/domain/enums";

/**
 * Lightweight member reference used inside `InstrumentSetRevision.members`.
 * Does not repeat setId/revision — those come from the parent.
 */
export interface InstrumentSetMemberRef {
  canonicalId: string;
  displaySymbol: string;
  venue: string | null;
}

/**
 * Produce the canonical instrument identity for deduplication and cross-check.
 *
 * Rules:
 * - All classes: trim surrounding whitespace, then uppercase.
 * - Crypto keeps separators (`btc-usd` → `BTC-USD`).
 *
 * Throws on empty input after trimming.
 */
export function canonicalizeInstrumentId(
  raw: string,
  instrumentClass: InstrumentClass,
): string {
  void instrumentClass;
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new Error(
      "canonicalizeInstrumentId: instrument id must not be empty after trimming",
    );
  }
  return trimmed.toUpperCase();
}
