import { eq } from "drizzle-orm";
import type { DbClient } from "../../db/client";
import { cycleFunnelOutcomes } from "../../db/schema";
import type { CycleFunnelOutcome } from "@electron/shared/domain/cycle-funnel";

/**
 * Persist one terminal cycle outcome + first-divergence reason (Solution 02 WS9).
 */
export class CycleFunnelService {
  constructor(private readonly db: DbClient) {}

  record(outcome: CycleFunnelOutcome): void {
    this.db.db
      .insert(cycleFunnelOutcomes)
      .values({
        cycleId: outcome.cycleId,
        sessionId: outcome.sessionId,
        inputId: outcome.inputId,
        originKind: outcome.originKind,
        terminalStage: outcome.terminalStage,
        outcome: outcome.outcome,
        reasonCode: outcome.reasonCode,
        detailJson: outcome.detailJson,
        occurredAt: outcome.occurredAt,
      })
      .onConflictDoUpdate({
        target: cycleFunnelOutcomes.cycleId,
        set: {
          terminalStage: outcome.terminalStage,
          outcome: outcome.outcome,
          reasonCode: outcome.reasonCode,
          detailJson: outcome.detailJson,
          occurredAt: outcome.occurredAt,
        },
      })
      .run();
  }

  get(cycleId: string): CycleFunnelOutcome | null {
    const row = this.db.db
      .select()
      .from(cycleFunnelOutcomes)
      .where(eq(cycleFunnelOutcomes.cycleId, cycleId))
      .get();
    if (!row) return null;
    return {
      cycleId: row.cycleId,
      sessionId: row.sessionId,
      inputId: row.inputId,
      originKind: row.originKind as CycleFunnelOutcome["originKind"],
      terminalStage: row.terminalStage as CycleFunnelOutcome["terminalStage"],
      outcome: row.outcome as CycleFunnelOutcome["outcome"],
      reasonCode: row.reasonCode,
      detailJson: row.detailJson,
      occurredAt: row.occurredAt,
    };
  }

  latestForSession(sessionId: string, limit = 50): CycleFunnelOutcome[] {
    return this.db.db
      .select()
      .from(cycleFunnelOutcomes)
      .where(eq(cycleFunnelOutcomes.sessionId, sessionId))
      .all()
      .slice(0, limit)
      .map((row) => ({
        cycleId: row.cycleId,
        sessionId: row.sessionId,
        inputId: row.inputId,
        originKind: row.originKind as CycleFunnelOutcome["originKind"],
        terminalStage: row.terminalStage as CycleFunnelOutcome["terminalStage"],
        outcome: row.outcome as CycleFunnelOutcome["outcome"],
        reasonCode: row.reasonCode,
        detailJson: row.detailJson,
        occurredAt: row.occurredAt,
      }));
  }

  /** Earliest non-advanced terminal stage in the current no-trade streak. */
  firstDivergence(sessionId: string): CycleFunnelOutcome | null {
    const rows = this.latestForSession(sessionId, 100);
    const ordered = [...rows].sort((a, b) =>
      b.occurredAt.localeCompare(a.occurredAt),
    );
    for (const row of ordered) {
      if (row.outcome === "filled" || row.outcome === "advanced") continue;
      return row;
    }
    return null;
  }
}
