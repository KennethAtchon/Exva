import type { DbClient } from "../client";

export type SessionInstrumentCacheRow = {
  sessionId: string;
  instruments: string;
  definitionHash: string;
  selectedAt: string;
  selectorAgentRunId: string | null;
};

export class InstrumentCacheRepo {
  constructor(private readonly client: DbClient) {}

  get(sessionId: string): SessionInstrumentCacheRow | null {
    const row = this.client.sqlite
      .prepare(
        `
        SELECT session_id, instruments, definition_hash, selected_at, selector_agent_run_id
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
        }
      | undefined;
    if (!row) return null;
    return {
      sessionId: row.session_id,
      instruments: row.instruments,
      definitionHash: row.definition_hash,
      selectedAt: row.selected_at,
      selectorAgentRunId: row.selector_agent_run_id ?? null,
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
  }): void {
    this.client.sqlite
      .prepare(
        `
        INSERT INTO session_instrument_cache (
          session_id, instruments, definition_hash, selected_at, selector_agent_run_id
        ) VALUES (@sessionId, @instruments, @definitionHash, @selectedAt, @selectorAgentRunId)
        ON CONFLICT(session_id) DO UPDATE SET
          instruments = excluded.instruments,
          definition_hash = excluded.definition_hash,
          selected_at = excluded.selected_at,
          selector_agent_run_id = excluded.selector_agent_run_id
        `,
      )
      .run({
        sessionId: input.sessionId,
        instruments: input.instruments,
        definitionHash: input.definitionHash,
        selectedAt: input.selectedAt,
        selectorAgentRunId: input.selectorAgentRunId,
      });
  }
}
