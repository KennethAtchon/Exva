import type { DbClient } from "../client";
import type { BrokerRoutingDefault, InstrumentClass, SessionBrokerRoutingOverride } from "@/lib/types";
import { toBrokerRoutingDefault, toSessionBrokerRoutingOverride } from "./mappers";

export class BrokerRoutingRepo {
  constructor(private readonly client: DbClient) {}

  listGlobalDefaults(): BrokerRoutingDefault[] {
    const rows = this.client.sqlite.prepare("SELECT * FROM broker_routing ORDER BY instrument_class ASC").all() as Record<string, unknown>[];
    return rows.map(toBrokerRoutingDefault);
  }

  upsertGlobalDefaults(input: BrokerRoutingDefault[]): void {
    const stmt = this.client.sqlite.prepare(
      `
      INSERT INTO broker_routing (instrument_class, default_broker_account_id)
      VALUES (?, ?)
      ON CONFLICT(instrument_class) DO UPDATE SET default_broker_account_id = excluded.default_broker_account_id
      `,
    );

    this.client.sqlite.transaction(() => {
      for (const row of input) {
        stmt.run(row.instrumentClass, row.defaultBrokerAccountId);
      }
    })();
  }

  listSessionOverrides(sessionId: string): SessionBrokerRoutingOverride[] {
    const rows = this.client.sqlite
      .prepare("SELECT * FROM session_broker_routing_overrides WHERE session_id = ? ORDER BY instrument_class ASC")
      .all(sessionId) as Record<string, unknown>[];
    return rows.map(toSessionBrokerRoutingOverride);
  }

  upsertSessionOverrides(
    sessionId: string,
    input: Array<{ instrumentClass: InstrumentClass; brokerAccountId: string | null }>,
  ): void {
    const deleteStmt = this.client.sqlite.prepare(
      "DELETE FROM session_broker_routing_overrides WHERE session_id = ? AND instrument_class = ?",
    );
    const upsertStmt = this.client.sqlite.prepare(
      `
      INSERT INTO session_broker_routing_overrides (session_id, instrument_class, broker_account_id)
      VALUES (?, ?, ?)
      ON CONFLICT(session_id, instrument_class) DO UPDATE SET broker_account_id = excluded.broker_account_id
      `,
    );

    this.client.sqlite.transaction(() => {
      for (const row of input) {
        if (row.brokerAccountId === null) {
          deleteStmt.run(sessionId, row.instrumentClass);
          continue;
        }

        upsertStmt.run(sessionId, row.instrumentClass, row.brokerAccountId);
      }
    })();
  }

  resolveBrokerAccountId(sessionId: string, instrumentClass: InstrumentClass): string | null {
    const override = this.client.sqlite
      .prepare(
        "SELECT broker_account_id FROM session_broker_routing_overrides WHERE session_id = ? AND instrument_class = ?",
      )
      .get(sessionId, instrumentClass) as { broker_account_id?: string } | undefined;
    if (override?.broker_account_id) {
      return override.broker_account_id;
    }

    const globalDefault = this.client.sqlite
      .prepare("SELECT default_broker_account_id FROM broker_routing WHERE instrument_class = ?")
      .get(instrumentClass) as { default_broker_account_id?: string } | undefined;

    return globalDefault?.default_broker_account_id ?? null;
  }
}
