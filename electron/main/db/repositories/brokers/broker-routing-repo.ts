import type { DbClient } from "../../client";
import type {
  BrokerRoutingDefault,
  InstrumentClass,
  SessionBrokerRoutingOverride,
} from "@/lib/types";
import { and, asc, eq } from "drizzle-orm";
import {
  brokerRoutingDefaults,
  sessionBrokerRoutingOverrides,
} from "../../schema";
import {
  toBrokerRoutingDefault,
  toSessionBrokerRoutingOverride,
} from "../system/mappers";

export class BrokerRoutingRepo {
  constructor(private readonly client: DbClient) {}

  listGlobalDefaults(): BrokerRoutingDefault[] {
    const rows = this.client.db
      .select()
      .from(brokerRoutingDefaults)
      .orderBy(asc(brokerRoutingDefaults.instrumentClass))
      .all();
    return rows.map(toBrokerRoutingDefault);
  }

  upsertGlobalDefaults(input: BrokerRoutingDefault[]): void {
    this.client.db.transaction((tx) => {
      for (const row of input) {
        tx.insert(brokerRoutingDefaults)
          .values({
            instrumentClass: row.instrumentClass,
            defaultBrokerAccountId: row.defaultBrokerAccountId,
          })
          .onConflictDoUpdate({
            target: brokerRoutingDefaults.instrumentClass,
            set: { defaultBrokerAccountId: row.defaultBrokerAccountId },
          })
          .run();
      }
    });
  }

  listSessionOverrides(sessionId: string): SessionBrokerRoutingOverride[] {
    const rows = this.client.db
      .select()
      .from(sessionBrokerRoutingOverrides)
      .where(eq(sessionBrokerRoutingOverrides.sessionId, sessionId))
      .orderBy(asc(sessionBrokerRoutingOverrides.instrumentClass))
      .all();
    return rows.map(toSessionBrokerRoutingOverride);
  }

  upsertSessionOverrides(
    sessionId: string,
    input: Array<{
      instrumentClass: InstrumentClass;
      brokerAccountId: string | null;
    }>,
  ): void {
    this.client.db.transaction((tx) => {
      for (const row of input) {
        if (row.brokerAccountId === null) {
          tx.delete(sessionBrokerRoutingOverrides)
            .where(
              and(
                eq(sessionBrokerRoutingOverrides.sessionId, sessionId),
                eq(
                  sessionBrokerRoutingOverrides.instrumentClass,
                  row.instrumentClass,
                ),
              ),
            )
            .run();
          continue;
        }

        tx.insert(sessionBrokerRoutingOverrides)
          .values({
            sessionId,
            instrumentClass: row.instrumentClass,
            brokerAccountId: row.brokerAccountId,
          })
          .onConflictDoUpdate({
            target: [
              sessionBrokerRoutingOverrides.sessionId,
              sessionBrokerRoutingOverrides.instrumentClass,
            ],
            set: { brokerAccountId: row.brokerAccountId },
          })
          .run();
      }
    });
  }

  resolveBrokerAccountId(
    sessionId: string,
    instrumentClass: InstrumentClass,
  ): string | null {
    const override = this.client.db
      .select({
        brokerAccountId: sessionBrokerRoutingOverrides.brokerAccountId,
      })
      .from(sessionBrokerRoutingOverrides)
      .where(
        and(
          eq(sessionBrokerRoutingOverrides.sessionId, sessionId),
          eq(sessionBrokerRoutingOverrides.instrumentClass, instrumentClass),
        ),
      )
      .get();
    if (override?.brokerAccountId) {
      return override.brokerAccountId;
    }

    const globalDefault = this.client.db
      .select({
        defaultBrokerAccountId: brokerRoutingDefaults.defaultBrokerAccountId,
      })
      .from(brokerRoutingDefaults)
      .where(eq(brokerRoutingDefaults.instrumentClass, instrumentClass))
      .get();

    return globalDefault?.defaultBrokerAccountId ?? null;
  }
}
