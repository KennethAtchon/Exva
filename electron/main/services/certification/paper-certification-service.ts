import { and, eq, gte, lt, sql } from "drizzle-orm";
import type { DbClient } from "../../db/client";
import {
  brokerAccounts,
  orderIntents,
  paperCertificationRuns,
  sessions,
  trades,
} from "../../db/schema";
import {
  PAPER_CERTIFICATION_NOTIONAL_USD,
  PAPER_CERTIFICATION_SYMBOL,
  type PaperCertificationRun,
  type PaperCertificationStatus,
} from "@electron/shared/domain/paper-certification";
import { getUsEquitySession } from "@electron/shared/instruments/us-equity-session";
import { AppError } from "@electron/shared/infra/errors";
import type { BrokerAdapter } from "../broker/adapters/broker-adapter";
import { createLogger } from "../infra/log";

const logger = createLogger("paper-certification");

export interface PaperCertificationDeps {
  db: DbClient;
  getAdapter: (brokerAccountId: string) => Promise<BrokerAdapter>;
  isKillSwitchEngaged: () => boolean;
  getWorkspaceMode: () => "paper" | "live";
  now?: () => Date;
  onUpdated?: (run: PaperCertificationRun) => void;
}

/**
 * Paper-only Alpaca SPY $10 round-trip certification (Solution 01).
 * Never calls AI, strategy edge, or Kelly sizing.
 */
export class PaperCertificationService {
  constructor(private readonly deps: PaperCertificationDeps) {}

  get(runId: string): PaperCertificationRun {
    const row = this.deps.db.db
      .select()
      .from(paperCertificationRuns)
      .where(eq(paperCertificationRuns.id, runId))
      .get();
    if (!row) {
      throw new AppError(`Certification run not found: ${runId}`, "NOT_FOUND");
    }
    return mapRun(row);
  }

  async arm(input: {
    sessionId: string;
    brokerAccountId: string;
  }): Promise<PaperCertificationRun> {
    if (this.deps.getWorkspaceMode() !== "paper") {
      throw new AppError(
        "Paper certification requires workspace paper mode",
        "CERT_LIVE_WORKSPACE",
      );
    }
    if (this.deps.isKillSwitchEngaged()) {
      throw new AppError(
        "Kill switch engaged — cannot arm certification",
        "CERT_KILL_SWITCH",
      );
    }

    const session = this.deps.db.db
      .select()
      .from(sessions)
      .where(eq(sessions.id, input.sessionId))
      .get();
    if (!session) {
      throw new AppError(`Session not found: ${input.sessionId}`, "NOT_FOUND");
    }
    if (session.executionMode !== "paper_only") {
      throw new AppError(
        "Paper certification requires session executionMode paper_only",
        "CERT_LIVE_SESSION",
      );
    }

    const account = this.deps.db.db
      .select()
      .from(brokerAccounts)
      .where(eq(brokerAccounts.id, input.brokerAccountId))
      .get();
    if (!account) {
      throw new AppError(
        `Broker account not found: ${input.brokerAccountId}`,
        "NOT_FOUND",
      );
    }
    if (account.mode !== "paper" || account.brokerType !== "alpaca") {
      throw new AppError(
        "Paper certification requires an Alpaca paper account",
        "CERT_LIVE_BROKER",
      );
    }

    const now = this.deps.now?.() ?? new Date();
    if (getUsEquitySession(now) !== "regular") {
      throw new AppError(
        "Market is not in regular hours — certification will not submit",
        "CERT_MARKET_CLOSED",
      );
    }

    const dayStart = utcDayStart(now).toISOString();
    const dayEnd = new Date(
      Date.parse(dayStart) + 24 * 60 * 60_000,
    ).toISOString();
    const completedToday = this.deps.db.db
      .select()
      .from(paperCertificationRuns)
      .where(
        and(
          eq(paperCertificationRuns.brokerAccountId, input.brokerAccountId),
          gte(paperCertificationRuns.armedAt, dayStart),
          lt(paperCertificationRuns.armedAt, dayEnd),
          sql`${paperCertificationRuns.status} in ('closed', 'failed', 'reconciliation_required')`,
        ),
      )
      .all();
    if (completedToday.length > 0) {
      throw new AppError(
        "Only one completed certification per broker account per UTC day",
        "CERT_DAILY_LIMIT",
      );
    }

    const adapter = await this.deps.getAdapter(input.brokerAccountId);
    const conn = await adapter.testConnection();
    if (!conn.ok) {
      throw new AppError(
        `Broker unreachable: ${conn.message}`,
        "CERT_BROKER_UNREACHABLE",
      );
    }

    const runId = crypto.randomUUID();
    const entryClientOrderId = `cert-entry-${runId}`;
    const prepare = adapter.prepareClientOrderId;
    if (!prepare) {
      throw new AppError(
        "Adapter missing prepareClientOrderId",
        "CERT_ADAPTER_INCOMPLETE",
      );
    }
    const entryWireId = prepare(entryClientOrderId);
    const armedAt = now.toISOString();

    this.deps.db.db.transaction((tx) => {
      tx.insert(paperCertificationRuns)
        .values({
          id: runId,
          sessionId: input.sessionId,
          brokerAccountId: input.brokerAccountId,
          symbol: PAPER_CERTIFICATION_SYMBOL,
          notionalUsd: PAPER_CERTIFICATION_NOTIONAL_USD,
          status: "armed",
          entryClientOrderId,
          entryWireClientOrderId: entryWireId,
          filledQuantity: 0,
          armedAt,
        })
        .run();
      tx.insert(orderIntents)
        .values({
          id: crypto.randomUUID(),
          sessionId: input.sessionId,
          signalId: null,
          originKind: "certification",
          brokerAccountId: input.brokerAccountId,
          canonicalClientOrderId: entryClientOrderId,
          wireClientOrderId: entryWireId,
          status: "created",
          side: "BUY",
          symbol: PAPER_CERTIFICATION_SYMBOL,
          notionalUsd: PAPER_CERTIFICATION_NOTIONAL_USD,
          createdAt: armedAt,
          updatedAt: armedAt,
        })
        .run();
    });

    this.setStatus(runId, "submitting_entry");
    try {
      const placed = await adapter.placeOrder({
        instrumentSymbol: PAPER_CERTIFICATION_SYMBOL,
        instrumentType: "stock",
        side: "BUY",
        sizeUsd: PAPER_CERTIFICATION_NOTIONAL_USD,
        clientOrderId: entryClientOrderId,
      });
      this.deps.db.db
        .update(paperCertificationRuns)
        .set({
          entryBrokerOrderId: placed.brokerOrderId,
          status: "entry_open",
        })
        .where(eq(paperCertificationRuns.id, runId))
        .run();
      this.deps.db.db
        .update(orderIntents)
        .set({
          brokerOrderId: placed.brokerOrderId,
          status: "acknowledged",
          updatedAt: new Date().toISOString(),
        })
        .where(
          and(
            eq(orderIntents.brokerAccountId, input.brokerAccountId),
            eq(orderIntents.canonicalClientOrderId, entryClientOrderId),
          ),
        )
        .run();
    } catch (err) {
      // Timeout path: look up by wire client ID before failing.
      const find = adapter.findOrderByClientOrderId;
      if (find) {
        const found = await find(entryWireId).catch(() => null);
        if (found) {
          this.deps.db.db
            .update(paperCertificationRuns)
            .set({
              entryBrokerOrderId: found.brokerOrderId,
              status: "entry_open",
            })
            .where(eq(paperCertificationRuns.id, runId))
            .run();
        } else {
          this.fail(
            runId,
            "CERT_SUBMIT_FAILED",
            err instanceof Error ? err.message : String(err),
          );
          throw err;
        }
      } else {
        this.fail(
          runId,
          "CERT_SUBMIT_FAILED",
          err instanceof Error ? err.message : String(err),
        );
        throw err;
      }
    }

    return this.reconcile(runId);
  }

  async reconcile(runId: string): Promise<PaperCertificationRun> {
    let run = this.get(runId);
    const adapter = await this.deps.getAdapter(run.brokerAccountId);

    if (
      run.status === "entry_open" ||
      run.status === "submitting_entry" ||
      run.status === "armed"
    ) {
      run = await this.reconcileEntry(run, adapter);
    }
    if (run.status === "entry_filled" || run.status === "submitting_exit") {
      run = await this.submitExit(run, adapter);
    }
    if (run.status === "exit_open") {
      run = await this.reconcileExit(run, adapter);
    }
    this.deps.onUpdated?.(run);
    return run;
  }

  private async reconcileEntry(
    run: PaperCertificationRun,
    adapter: BrokerAdapter,
  ): Promise<PaperCertificationRun> {
    const wire =
      this.deps.db.db
        .select()
        .from(paperCertificationRuns)
        .where(eq(paperCertificationRuns.id, run.id))
        .get()?.entryWireClientOrderId ?? run.entryClientOrderId;

    const find = adapter.findOrderByClientOrderId;
    const found = find
      ? await find(wire)
      : run.entryBrokerOrderId
        ? await statusFromGetOrder(adapter, run.entryBrokerOrderId)
        : null;

    if (!found) return run;
    if (found.status !== "filled" && found.status !== "partially_filled") {
      if (
        found.status === "canceled" ||
        found.status === "rejected" ||
        found.status === "expired"
      ) {
        return this.fail(run.id, "CERT_ENTRY_TERMINAL", found.rawStatus);
      }
      return this.get(run.id);
    }

    const filledQty = found.filledQty;
    const now = new Date().toISOString();
    this.deps.db.db
      .update(paperCertificationRuns)
      .set({
        entryBrokerOrderId: found.brokerOrderId,
        filledQuantity: filledQty,
        status:
          found.status === "filled" ? "entry_filled" : "entry_open",
      })
      .where(eq(paperCertificationRuns.id, run.id))
      .run();

    if (found.status === "filled") {
      // Persist visible certification trade.
      this.deps.db.db
        .insert(trades)
        .values({
          id: crypto.randomUUID(),
          sessionId: run.sessionId,
          brokerAccountId: run.brokerAccountId,
          instrumentSymbol: run.symbol,
          instrumentType: "stock",
          side: "BUY",
          entryPrice: found.filledAvgPrice,
          positionSizeUsd: PAPER_CERTIFICATION_NOTIONAL_USD,
          strategy: "paper-execution-canary",
          status: "open",
          openedAt: now,
          brokerOrderId: found.brokerOrderId,
          clientOrderId: run.entryClientOrderId,
          originKind: "certification",
          createdAt: now,
        })
        .run();
    }
    return this.get(run.id);
  }

  private async submitExit(
    run: PaperCertificationRun,
    adapter: BrokerAdapter,
  ): Promise<PaperCertificationRun> {
    if (run.filledQuantity <= 0) {
      return this.fail(run.id, "CERT_NO_FILL", "Entry filled quantity is zero");
    }
    const exitClientOrderId =
      run.exitClientOrderId ?? `cert-exit-${run.id}`;
    const prepare = adapter.prepareClientOrderId!;
    const exitWireId = prepare(exitClientOrderId);
    const now = new Date().toISOString();

    this.deps.db.db.transaction((tx) => {
      tx.update(paperCertificationRuns)
        .set({
          status: "submitting_exit",
          exitClientOrderId,
          exitWireClientOrderId: exitWireId,
        })
        .where(eq(paperCertificationRuns.id, run.id))
        .run();
      tx.insert(orderIntents)
        .values({
          id: crypto.randomUUID(),
          sessionId: run.sessionId,
          originKind: "certification",
          brokerAccountId: run.brokerAccountId,
          canonicalClientOrderId: exitClientOrderId,
          wireClientOrderId: exitWireId,
          status: "created",
          side: "SELL",
          symbol: run.symbol,
          quantity: run.filledQuantity,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing()
        .run();
    });

    // Sell via units if placeOrderV2 exists; else approximate with notional.
    try {
      let brokerOrderId: string;
      if (adapter.placeOrderV2) {
        const result = await adapter.placeOrderV2({
          instrument: {
            symbol: run.symbol,
            instrumentClass: "stock",
          },
          side: "SELL",
          orderType: "market",
          quantity: { kind: "units", value: run.filledQuantity },
          clientOrderId: exitClientOrderId,
          timeInForce: "day",
        });
        brokerOrderId = result.brokerOrderId;
      } else {
        const result = await adapter.placeOrder({
          instrumentSymbol: run.symbol,
          instrumentType: "stock",
          side: "SELL",
          sizeUsd: PAPER_CERTIFICATION_NOTIONAL_USD,
          clientOrderId: exitClientOrderId,
        });
        brokerOrderId = result.brokerOrderId;
      }
      this.deps.db.db
        .update(paperCertificationRuns)
        .set({ exitBrokerOrderId: brokerOrderId, status: "exit_open" })
        .where(eq(paperCertificationRuns.id, run.id))
        .run();
    } catch (err) {
      const find = adapter.findOrderByClientOrderId;
      const found = find ? await find(exitWireId).catch(() => null) : null;
      if (found) {
        this.deps.db.db
          .update(paperCertificationRuns)
          .set({
            exitBrokerOrderId: found.brokerOrderId,
            status: "exit_open",
          })
          .where(eq(paperCertificationRuns.id, run.id))
          .run();
      } else {
        return this.fail(
          run.id,
          "CERT_EXIT_SUBMIT_FAILED",
          err instanceof Error ? err.message : String(err),
          "reconciliation_required",
        );
      }
    }
    return this.get(run.id);
  }

  private async reconcileExit(
    run: PaperCertificationRun,
    adapter: BrokerAdapter,
  ): Promise<PaperCertificationRun> {
    const row = this.deps.db.db
      .select()
      .from(paperCertificationRuns)
      .where(eq(paperCertificationRuns.id, run.id))
      .get();
    const wire = row?.exitWireClientOrderId;
    if (!wire) return run;

    const find = adapter.findOrderByClientOrderId;
    const found = find ? await find(wire) : null;
    if (!found) return run;
    if (found.status === "filled") {
      const now = new Date().toISOString();
      this.deps.db.db
        .update(paperCertificationRuns)
        .set({
          status: "closed",
          completedAt: now,
          exitBrokerOrderId: found.brokerOrderId,
        })
        .where(eq(paperCertificationRuns.id, run.id))
        .run();
      this.deps.db.db
        .update(trades)
        .set({
          status: "closed",
          closedAt: now,
          finalPnlUsd: 0,
          closureSource: "poll",
        })
        .where(
          and(
            eq(trades.sessionId, run.sessionId),
            eq(trades.clientOrderId, run.entryClientOrderId),
            eq(trades.originKind, "certification"),
          ),
        )
        .run();
      logger.info(
        { runId: run.id },
        "paper certification closed — integration certified, not strategy validated",
      );
    } else if (
      found.status === "canceled" ||
      found.status === "rejected" ||
      found.status === "expired"
    ) {
      return this.fail(
        run.id,
        "CERT_EXIT_TERMINAL",
        found.rawStatus,
        "reconciliation_required",
      );
    }
    return this.get(run.id);
  }

  private setStatus(runId: string, status: PaperCertificationStatus): void {
    this.deps.db.db
      .update(paperCertificationRuns)
      .set({ status })
      .where(eq(paperCertificationRuns.id, runId))
      .run();
  }

  private fail(
    runId: string,
    code: string,
    message: string,
    status: PaperCertificationStatus = "failed",
  ): PaperCertificationRun {
    this.deps.db.db
      .update(paperCertificationRuns)
      .set({
        status,
        failureCode: code,
        failureMessage: message,
        completedAt: new Date().toISOString(),
      })
      .where(eq(paperCertificationRuns.id, runId))
      .run();
    return this.get(runId);
  }
}

function mapRun(
  row: typeof paperCertificationRuns.$inferSelect,
): PaperCertificationRun {
  return {
    id: row.id,
    sessionId: row.sessionId,
    brokerAccountId: row.brokerAccountId,
    symbol: "SPY",
    notionalUsd: 10,
    status: row.status as PaperCertificationStatus,
    entryClientOrderId: row.entryClientOrderId,
    entryBrokerOrderId: row.entryBrokerOrderId,
    exitClientOrderId: row.exitClientOrderId,
    exitBrokerOrderId: row.exitBrokerOrderId,
    filledQuantity: row.filledQuantity,
    failureCode: row.failureCode,
    failureMessage: row.failureMessage,
    armedAt: row.armedAt,
    completedAt: row.completedAt,
  };
}

function utcDayStart(now: Date): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

async function statusFromGetOrder(
  adapter: BrokerAdapter,
  brokerOrderId: string,
): Promise<{
  brokerOrderId: string;
  status: string;
  filledQty: number;
  filledAvgPrice: number | null;
  rawStatus: string;
} | null> {
  const st = await adapter.getOrderStatus(brokerOrderId);
  return {
    brokerOrderId,
    status: st.status === "closed" ? "filled" : st.status,
    filledQty: 0,
    filledAvgPrice: st.latestPrice,
    rawStatus: st.status,
  };
}
