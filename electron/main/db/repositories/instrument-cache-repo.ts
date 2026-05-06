import type { DbClient } from "../client";

export type SessionInstrumentCacheRow = {
  sessionId: string;
  instruments: string;
  definitionHash: string;
  selectedAt: string;
  selectorAgentRunId: string | null;
  cycleId: string;
  researchBriefsJson: string | null;
  researchGeneratedAt: string | null;
};

export class InstrumentCacheRepo {
  constructor(private readonly client: DbClient) {}

  get(sessionId: string): SessionInstrumentCacheRow | null {
    const row = this.client.sqlite
      .prepare(
        `
        SELECT session_id, instruments, definition_hash, selected_at, selector_agent_run_id,
               cycle_id, research_briefs_json, research_generated_at
        FROM session_instrument_cache
        WHERE session_id = ?
        `,
      )
      .get(sessionId) as
      | {
          session_id: string;
          instruments: string;
          definition_hash: string;
          selected_at: string;
          selector_agent_run_id: string | null;
          cycle_id: string | null;
          research_briefs_json: string | null;
          research_generated_at: string | null;
        }
      | undefined;
    if (!row) return null;
    return {
      sessionId: row.session_id,
      instruments: row.instruments,
      definitionHash: row.definition_hash,
      selectedAt: row.selected_at,
      selectorAgentRunId: row.selector_agent_run_id ?? null,
      cycleId: row.cycle_id ?? "",
      researchBriefsJson: row.research_briefs_json ?? null,
      researchGeneratedAt: row.research_generated_at ?? null,
    };
  }

  clear(sessionId: string): void {
    this.client.sqlite.prepare("DELETE FROM session_instrument_cache WHERE session_id = ?").run(sessionId);
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
  }): void {
    const researchBriefsJson = input.researchBriefsJson ?? null;
    const researchGeneratedAt = input.researchGeneratedAt ?? null;
    this.client.sqlite
      .prepare(
        `
        INSERT INTO session_instrument_cache (
          session_id, instruments, definition_hash, selected_at, selector_agent_run_id,
          cycle_id, research_briefs_json, research_generated_at
        ) VALUES (
          @sessionId, @instruments, @definitionHash, @selectedAt, @selectorAgentRunId,
          @cycleId, @researchBriefsJson, @researchGeneratedAt
        )
        ON CONFLICT(session_id) DO UPDATE SET
          instruments = excluded.instruments,
          definition_hash = excluded.definition_hash,
          selected_at = excluded.selected_at,
          selector_agent_run_id = excluded.selector_agent_run_id,
          cycle_id = excluded.cycle_id,
          research_briefs_json = excluded.research_briefs_json,
          research_generated_at = excluded.research_generated_at
        `,
      )
      .run({
        sessionId: input.sessionId,
        instruments: input.instruments,
        definitionHash: input.definitionHash,
        selectedAt: input.selectedAt,
        selectorAgentRunId: input.selectorAgentRunId,
        cycleId: input.cycleId,
        researchBriefsJson,
        researchGeneratedAt,
      });
  }
}
