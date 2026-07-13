import { eq } from "drizzle-orm";
import { AppError } from "@electron/shared/infra/errors";
import type { DbClient } from "../../client";
import { paperBalances } from "../../schema";

/** Default starting paper USDC for ghost venues (Polymarket / Kraken). */
export const DEFAULT_PAPER_STARTING_BALANCE_USD = 1_000;

export interface PaperBalanceRow {
  accountId: string;
  currency: string;
  balance: number;
  startingBalance: number;
  updatedAt: string;
}

/**
 * Persisted paper balances for ghost-fill venues. Debit/credit are
 * synchronous SQLite writes so fills survive adapter rebuilds and restarts.
 */
export class PaperBalancesRepo {
  constructor(private readonly client: DbClient) {}

  find(accountId: string): PaperBalanceRow | null {
    const row = this.client.db
      .select()
      .from(paperBalances)
      .where(eq(paperBalances.accountId, accountId))
      .get();
    if (!row) return null;
    return {
      accountId: row.accountId,
      currency: row.currency,
      balance: row.balance,
      startingBalance: row.startingBalance,
      updatedAt: row.updatedAt,
    };
  }

  /**
   * Ensure a row exists; create with `startingBalance` (or default) if missing.
   * Returns the current balance.
   */
  ensure(
    accountId: string,
    startingBalance: number = DEFAULT_PAPER_STARTING_BALANCE_USD,
  ): PaperBalanceRow {
    const existing = this.find(accountId);
    if (existing) return existing;
    const now = new Date().toISOString();
    this.client.db
      .insert(paperBalances)
      .values({
        accountId,
        currency: "USD",
        balance: startingBalance,
        startingBalance,
        updatedAt: now,
      })
      .run();
    const created = this.find(accountId);
    if (!created) {
      throw new AppError(
        `Failed to create paper balance for ${accountId}`,
        "UNKNOWN",
        { accountId },
      );
    }
    return created;
  }

  getBalance(accountId: string): number {
    return this.ensure(accountId).balance;
  }

  /** Debit paper funds; throws BROKER_INSUFFICIENT_FUNDS when short. */
  debit(accountId: string, amount: number): number {
    if (!(amount > 0)) return this.getBalance(accountId);
    const row = this.ensure(accountId);
    if (row.balance < amount) {
      throw new AppError(
        `Insufficient paper balance: need $${amount.toFixed(2)}, have $${row.balance.toFixed(2)}.`,
        "BROKER_INSUFFICIENT_FUNDS",
        { accountId, need: amount, have: row.balance },
      );
    }
    const next = row.balance - amount;
    const now = new Date().toISOString();
    this.client.db
      .update(paperBalances)
      .set({ balance: next, updatedAt: now })
      .where(eq(paperBalances.accountId, accountId))
      .run();
    return next;
  }

  credit(accountId: string, amount: number): number {
    if (!(amount > 0)) return this.getBalance(accountId);
    const row = this.ensure(accountId);
    const next = row.balance + amount;
    const now = new Date().toISOString();
    this.client.db
      .update(paperBalances)
      .set({ balance: next, updatedAt: now })
      .where(eq(paperBalances.accountId, accountId))
      .run();
    return next;
  }

  /**
   * Reset balance to startingBalance (optionally update startingBalance first).
   * Returns the new balance.
   */
  reset(accountId: string, startingBalance?: number): PaperBalanceRow {
    const row = this.ensure(accountId);
    const start =
      startingBalance != null && startingBalance > 0
        ? startingBalance
        : row.startingBalance;
    const now = new Date().toISOString();
    this.client.db
      .update(paperBalances)
      .set({
        balance: start,
        startingBalance: start,
        updatedAt: now,
      })
      .where(eq(paperBalances.accountId, accountId))
      .run();
    const updated = this.find(accountId);
    if (!updated) {
      throw new AppError(
        `Failed to reset paper balance for ${accountId}`,
        "UNKNOWN",
        { accountId },
      );
    }
    return updated;
  }
}
