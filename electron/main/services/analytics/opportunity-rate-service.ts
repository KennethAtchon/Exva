/**
 * Per-evaluation opportunity rate (Solution 06 WS4).
 * Answers: how many fair chances did the strategy get today?
 */

import { and, eq } from "drizzle-orm";
import type { DbClient } from "../../db/client";
import { scanEvaluationOutcomes } from "../../db/schema";

export type ScanEvalOutcomeKind =
  | "setup"
  | "no_setup"
  | "insufficient_history"
  | "stale"
  | "error"
  | "empty_universe";

export interface ScanEvaluationRecord {
  sessionId: string | null;
  groupKey: string;
  strategyId: string;
  symbol: string;
  timeframe: string;
  evaluatedAt: string;
  barWindowHash: string | null;
  storedBars: number | null;
  minEvaluableBars: number | null;
  outcome: ScanEvalOutcomeKind;
}

export class OpportunityRateService {
  constructor(private readonly db: DbClient) {}

  record(rows: ScanEvaluationRecord[]): void {
    if (rows.length === 0) return;
    const now = new Date().toISOString();
    for (const row of rows) {
      this.db.db
        .insert(scanEvaluationOutcomes)
        .values({
          id: crypto.randomUUID(),
          sessionId: row.sessionId,
          groupKey: row.groupKey,
          strategyId: row.strategyId,
          symbol: row.symbol,
          timeframe: row.timeframe,
          evaluatedAt: row.evaluatedAt,
          barWindowHash: row.barWindowHash,
          storedBars: row.storedBars,
          minEvaluableBars: row.minEvaluableBars,
          outcome: row.outcome,
          dayKey: row.evaluatedAt.slice(0, 10),
          createdAt: now,
        })
        .run();
    }
  }

  /** Setup rate and eligible counts for a session day. */
  summarize(sessionId: string, dayKey: string): {
    total: number;
    eligibleEvaluations: number;
    repeatEvaluations: number;
    setups: number;
    setupRate: number;
    blockedByHistory: number;
    blockedByHistoryRate: number;
    expectedSetupsPerDay: number;
  } {
    const rows = this.db.db
      .select()
      .from(scanEvaluationOutcomes)
      .where(
        and(
          eq(scanEvaluationOutcomes.sessionId, sessionId),
          eq(scanEvaluationOutcomes.dayKey, dayKey),
        ),
      )
      .all();

    const seen = new Set<string>();
    let eligible = 0;
    let repeats = 0;
    let setups = 0;
    let blockedHistory = 0;
    for (const row of rows) {
      if (row.outcome === "insufficient_history") blockedHistory += 1;
      if (row.outcome === "setup" || row.outcome === "no_setup") {
        const key = `${row.symbol}:${row.barWindowHash ?? row.evaluatedAt}`;
        if (seen.has(key)) {
          repeats += 1;
        } else {
          seen.add(key);
          eligible += 1;
          if (row.outcome === "setup") setups += 1;
        }
      }
    }
    const setupRate = eligible > 0 ? setups / eligible : 0;
    return {
      total: rows.length,
      eligibleEvaluations: eligible,
      repeatEvaluations: repeats,
      setups,
      setupRate,
      blockedByHistory: blockedHistory,
      blockedByHistoryRate: rows.length > 0 ? blockedHistory / rows.length : 0,
      expectedSetupsPerDay: setupRate * eligible,
    };
  }
}

/** Map executor instrument kinds onto opportunity-rate outcomes. */
export function mapInstrumentKindToOpportunity(
  kind: string,
): ScanEvalOutcomeKind {
  switch (kind) {
    case "signal":
      return "setup";
    case "no_setup":
      return "no_setup";
    case "insufficient_bars":
      return "insufficient_history";
    case "input_stale":
      return "stale";
    case "empty_universe":
      return "empty_universe";
    default:
      return "error";
  }
}
