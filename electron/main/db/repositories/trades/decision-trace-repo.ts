import { eq } from "drizzle-orm";
import type { DbClient } from "../../client";
import { decisionTraces } from "../../schema";
import type {
  DecisionTraceRecord,
  TradeDecisionTrace,
} from "@electron/shared/domain";

export interface DecisionTraceMeta {
  cycleId: string;
  sessionId: string;
  instrumentSymbol: string;
}

/**
 * Persists deterministic gate decisions per cycle. Engines write fragments
 * incrementally (write-through, before any throw) so a cycle rejected early
 * still leaves a durable trace for the trade-detail panel and autopsy.
 */
export class DecisionTraceRepo {
  constructor(private readonly client: DbClient) {}

  /**
   * Merge a fragment of the trace into the cycle's row, creating it if absent.
   * Top-level keys (candidateValidation, sizing, riskGate, …) are shallow-merged
   * so each engine can write its own slice independently.
   */
  upsertFragment(
    meta: DecisionTraceMeta,
    fragment: Partial<TradeDecisionTrace>,
  ): void {
    const now = new Date().toISOString();
    const existing = this.rawByCycle(meta.cycleId);
    const merged: TradeDecisionTrace = {
      ...(existing?.trace ?? {}),
      ...fragment,
    };
    const traceJson = JSON.stringify(merged);

    if (existing) {
      this.client.db
        .update(decisionTraces)
        .set({ traceJson, updatedAt: now })
        .where(eq(decisionTraces.cycleId, meta.cycleId))
        .run();
      return;
    }
    this.client.db
      .insert(decisionTraces)
      .values({
        cycleId: meta.cycleId,
        sessionId: meta.sessionId,
        tradeId: null,
        instrumentSymbol: meta.instrumentSymbol,
        traceJson,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }

  /** Link the trace to a trade once one is created for the cycle. */
  linkTrade(cycleId: string, tradeId: string): void {
    this.client.db
      .update(decisionTraces)
      .set({ tradeId, updatedAt: new Date().toISOString() })
      .where(eq(decisionTraces.cycleId, cycleId))
      .run();
  }

  getByCycle(cycleId: string): TradeDecisionTrace | null {
    return this.rawByCycle(cycleId)?.trace ?? null;
  }

  getByTrade(tradeId: string): TradeDecisionTrace | null {
    const row = this.client.db
      .select()
      .from(decisionTraces)
      .where(eq(decisionTraces.tradeId, tradeId))
      .get();
    return row ? this.parse(row.traceJson) : null;
  }

  private rawByCycle(
    cycleId: string,
  ): { record: DecisionTraceRecord; trace: TradeDecisionTrace } | null {
    const row = this.client.db
      .select()
      .from(decisionTraces)
      .where(eq(decisionTraces.cycleId, cycleId))
      .get();
    if (!row) return null;
    const trace = this.parse(row.traceJson);
    return {
      trace,
      record: {
        cycleId: row.cycleId,
        sessionId: row.sessionId,
        tradeId: row.tradeId,
        instrumentSymbol: row.instrumentSymbol,
        trace,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      },
    };
  }

  private parse(json: string): TradeDecisionTrace {
    try {
      return JSON.parse(json) as TradeDecisionTrace;
    } catch {
      return {};
    }
  }
}
