import { and, eq } from "drizzle-orm";
import type { DbClient } from "../../db/client";
import { orderIntents } from "../../db/schema";
import type { BrokerAdapter } from "../broker/adapters/broker-adapter";

export interface PersistOrderIntentInput {
  sessionId: string;
  brokerAccountId: string;
  canonicalClientOrderId: string;
  side: "BUY" | "SELL";
  symbol: string;
  notionalUsd?: number;
  quantity?: number;
  signalId?: string | null;
  originKind?: "strategy" | "certification";
}

/**
 * Durable order intent ledger (Solution 01 / 10).
 * Writes before broker HTTP so restart/resume can correlate client IDs.
 */
export class OrderIntentService {
  constructor(private readonly db: DbClient) {}

  persist(
    adapter: BrokerAdapter,
    input: PersistOrderIntentInput,
  ): string | null {
    const prepare = adapter.prepareClientOrderId;
    if (!prepare) return null;

    const wireClientOrderId = prepare(input.canonicalClientOrderId);
    const now = new Date().toISOString();
    const id = crypto.randomUUID();

    this.db.db
      .insert(orderIntents)
      .values({
        id,
        sessionId: input.sessionId,
        signalId: input.signalId ?? null,
        originKind: input.originKind ?? "strategy",
        brokerAccountId: input.brokerAccountId,
        canonicalClientOrderId: input.canonicalClientOrderId,
        wireClientOrderId,
        status: "created",
        side: input.side,
        symbol: input.symbol,
        notionalUsd: input.notionalUsd ?? null,
        quantity: input.quantity ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .run();

    return id;
  }

  acknowledge(
    brokerAccountId: string,
    canonicalClientOrderId: string,
    brokerOrderId: string,
  ): void {
    this.db.db
      .update(orderIntents)
      .set({
        brokerOrderId,
        status: "acknowledged",
        updatedAt: new Date().toISOString(),
      })
      .where(
        and(
          eq(orderIntents.brokerAccountId, brokerAccountId),
          eq(orderIntents.canonicalClientOrderId, canonicalClientOrderId),
        ),
      )
      .run();
  }
}
