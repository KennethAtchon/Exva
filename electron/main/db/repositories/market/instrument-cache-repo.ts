import type { DbClient } from "../../client";
import { eq } from "drizzle-orm";
import { sessionInstrumentCache } from "../../schema";

export type SessionInstrumentCacheRow = {
  sessionId: string;
  instruments: string;
  definitionHash: string;
  selectedAt: string;
  selectorAgentRunId: string | null;
  cycleId: string;
  researchBriefsJson: string | null;
  researchGeneratedAt: string | null;
  expiresAt: string | null;
};

export class InstrumentCacheRepo {
  constructor(private readonly client: DbClient) {}

  get(sessionId: string): SessionInstrumentCacheRow | null {
    const row = this.client.db
      .select()
      .from(sessionInstrumentCache)
      .where(eq(sessionInstrumentCache.sessionId, sessionId))
      .get();
    if (!row) return null;
    return {
      sessionId: row.sessionId,
      instruments: row.instruments,
      definitionHash: row.definitionHash,
      selectedAt: row.selectedAt,
      selectorAgentRunId: row.selectorAgentRunId ?? null,
      cycleId: row.cycleId ?? "",
      researchBriefsJson: row.researchBriefsJson ?? null,
      researchGeneratedAt: row.researchGeneratedAt ?? null,
      expiresAt: row.expiresAt ?? null,
    };
  }

  clear(sessionId: string): void {
    this.client.db
      .delete(sessionInstrumentCache)
      .where(eq(sessionInstrumentCache.sessionId, sessionId))
      .run();
  }

  save(input: {
    sessionId: string;
    instruments: string;
    definitionHash: string;
    selectedAt: string;
    selectorAgentRunId: string | null;
    cycleId: string;
    researchBriefsJson?: string | null;
    researchGeneratedAt?: string | null;
    expiresAt?: string | null;
  }): void {
    const researchBriefsJson = input.researchBriefsJson ?? null;
    const researchGeneratedAt = input.researchGeneratedAt ?? null;
    const expiresAt = input.expiresAt ?? null;
    this.client.db
      .insert(sessionInstrumentCache)
      .values({
        sessionId: input.sessionId,
        instruments: input.instruments,
        definitionHash: input.definitionHash,
        selectedAt: input.selectedAt,
        selectorAgentRunId: input.selectorAgentRunId,
        cycleId: input.cycleId,
        researchBriefsJson,
        researchGeneratedAt,
        expiresAt,
      })
      .onConflictDoUpdate({
        target: sessionInstrumentCache.sessionId,
        set: {
          instruments: input.instruments,
          definitionHash: input.definitionHash,
          selectedAt: input.selectedAt,
          selectorAgentRunId: input.selectorAgentRunId,
          cycleId: input.cycleId,
          researchBriefsJson,
          researchGeneratedAt,
          expiresAt,
        },
      })
      .run();
  }
}
