import { and, eq } from "drizzle-orm";
import type { DbClient } from "../../client";
import { paperPositions } from "../../schema";

export interface PaperPositionRow {
  brokerOrderId: string;
  accountId: string;
  venue: string;
  instrumentSymbol: string;
  side: "BUY" | "SELL";
  shares: number;
  entryPrice: number;
  sizeUsd: number;
  open: boolean;
  resting: boolean;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertPaperPositionInput {
  brokerOrderId: string;
  accountId: string;
  venue: string;
  instrumentSymbol: string;
  side: "BUY" | "SELL";
  shares: number;
  entryPrice: number;
  sizeUsd: number;
  open: boolean;
  resting: boolean;
  metadata?: Record<string, unknown>;
}

/**
 * Persisted ghost (paper) positions so a broker adapter rebuilt after a
 * restart can rehydrate open/resting positions by broker order id instead
 * of treating an unknown order id as already closed (finish-line F1.4/F1.1).
 */
export class PaperPositionsRepo {
  constructor(private readonly db: DbClient) {}

  upsert(input: UpsertPaperPositionInput): PaperPositionRow {
    const now = new Date().toISOString();
    const existing = this.get(input.brokerOrderId);
    const metadataJson = JSON.stringify(input.metadata ?? {});
    if (existing) {
      this.db.db
        .update(paperPositions)
        .set({
          venue: input.venue,
          instrumentSymbol: input.instrumentSymbol,
          side: input.side,
          shares: input.shares,
          entryPrice: input.entryPrice,
          sizeUsd: input.sizeUsd,
          open: input.open,
          resting: input.resting,
          metadataJson,
          updatedAt: now,
        })
        .where(eq(paperPositions.brokerOrderId, input.brokerOrderId))
        .run();
    } else {
      this.db.db
        .insert(paperPositions)
        .values({
          brokerOrderId: input.brokerOrderId,
          accountId: input.accountId,
          venue: input.venue,
          instrumentSymbol: input.instrumentSymbol,
          side: input.side,
          shares: input.shares,
          entryPrice: input.entryPrice,
          sizeUsd: input.sizeUsd,
          open: input.open,
          resting: input.resting,
          metadataJson,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    }
    const row = this.get(input.brokerOrderId);
    if (!row) throw new Error("paper position upsert vanished");
    return row;
  }

  get(brokerOrderId: string): PaperPositionRow | null {
    const row = this.db.db
      .select()
      .from(paperPositions)
      .where(eq(paperPositions.brokerOrderId, brokerOrderId))
      .get();
    return row ? mapRow(row) : null;
  }

  listOpenByAccount(accountId: string): PaperPositionRow[] {
    return this.db.db
      .select()
      .from(paperPositions)
      .where(
        and(
          eq(paperPositions.accountId, accountId),
          eq(paperPositions.open, true),
        ),
      )
      .all()
      .map(mapRow);
  }

  setClosed(brokerOrderId: string): void {
    this.db.db
      .update(paperPositions)
      .set({ open: false, resting: false, updatedAt: new Date().toISOString() })
      .where(eq(paperPositions.brokerOrderId, brokerOrderId))
      .run();
  }
}

function mapRow(row: typeof paperPositions.$inferSelect): PaperPositionRow {
  let metadata: Record<string, unknown> = {};
  try {
    metadata = JSON.parse(row.metadataJson) as Record<string, unknown>;
  } catch {
    metadata = {};
  }
  return {
    brokerOrderId: row.brokerOrderId,
    accountId: row.accountId,
    venue: row.venue,
    instrumentSymbol: row.instrumentSymbol,
    side: row.side as "BUY" | "SELL",
    shares: row.shares,
    entryPrice: row.entryPrice,
    sizeUsd: row.sizeUsd,
    open: row.open,
    resting: row.resting,
    metadata,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
