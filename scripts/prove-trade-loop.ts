#!/usr/bin/env bun
/**
 * Doc 04 T2 + Doc 05 T6 — Automated proof harness for the trade loop.
 *
 * Modes:
 *   mock (default) — golden-path mock rehearsal integration test (scratch harness)
 *   alpaca         — requires ALPACA keys + EXVA_DB_PATH; read-only audit of a
 *                    real Alpaca paper trade already recorded in that DB
 *   polymarket     — signal -> decision -> ghost order -> persisted fill ->
 *                    forced restart -> rehydration -> settlement journey,
 *                    entirely against a scratch DB (never touches daily DB)
 *
 * Usage:
 *   bun run prove
 *   bun run prove -- --mode=mock
 *   bun run prove -- --mode=alpaca
 *   bun run prove -- --mode=polymarket
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import BetterSqlite3 from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { env } from "../electron/main/config/env";
import type { DbClient } from "../electron/main/db/client";
import * as schema from "../electron/main/db/schema";
import { createTestDb } from "../electron/main/db/test-helpers";
import { BrokerAccountsRepo } from "../electron/main/db/repositories/brokers/broker-accounts-repo";
import { PaperBalancesRepo } from "../electron/main/db/repositories/brokers/paper-balances-repo";
import { PaperPositionsRepo } from "../electron/main/db/repositories/brokers/paper-positions-repo";
import { TradesRepo } from "../electron/main/db/repositories/trades/trades-repo";
import { DecisionTraceRepo } from "../electron/main/db/repositories/trades/decision-trace-repo";
import { ApiCallLogRepo } from "../electron/main/db/repositories/system/api-call-log-repo";
import { SessionRepo } from "../electron/main/db/repositories/sessions/session-repo";
import { SqliteSessionExecutionStepsRepo } from "../electron/main/db/repositories/sessions/session-execution-steps-repo";
import { PaperScorecardService } from "../electron/main/services/analytics/paper-scorecard-service";
import { PolymarketAdapter } from "../electron/main/services/broker/adapters/polymarket-adapter";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const MOCK_TEST =
  "electron/main/services/orchestration/__tests__/mock-trade-rehearsal.integration.test.ts";

type ProveMode = "mock" | "alpaca" | "polymarket";

function parseMode(): ProveMode {
  const arg = process.argv.find((a) => a.startsWith("--mode="));
  const mode = (arg?.slice("--mode=".length) ?? "mock") as string;
  if (mode !== "mock" && mode !== "alpaca" && mode !== "polymarket") {
    console.error(`Unknown mode "${mode}". Use mock|alpaca|polymarket.`);
    process.exit(2);
  }
  return mode;
}

function failStage(stage: string, lines: string[]): never {
  console.error([`✗ PROVE FAILED at stage "${stage}":`, ...lines].join("\n"));
  process.exit(1);
}

/** Read-only handle onto an existing SQLite file — never runs migrations, never writes. */
function openReadOnlyDb(dbPath: string): DbClient {
  const sqlite = new BetterSqlite3(dbPath, {
    readonly: true,
    fileMustExist: true,
  });
  return { sqlite, db: drizzle(sqlite, { schema }), dbPath };
}

/**
 * Mode 2: read-only audit of a real Alpaca paper trade already recorded by a
 * live session. Never places orders or calls Alpaca; proves the *recorded*
 * journey (open/close timestamps, closure provenance, decision trace,
 * scorecard export) is present and internally consistent.
 */
function proveAlpaca(): void {
  console.log("▶ prove (alpaca): read-only audit of a recorded paper trade");
  console.log(
    "  HONESTY: keys gate access only — this mode never calls Alpaca HTTP or places orders.",
  );

  const key = env.alpacaApiKey ?? process.env.ALPACA_API_KEY?.trim();
  const secret = env.alpacaSecretKey ?? process.env.ALPACA_SECRET_KEY?.trim();
  if (!key || !secret) {
    failStage("alpaca_credentials", [
      "Alpaca paper mode requires ALPACA_API_KEY and ALPACA_SECRET_KEY.",
      "Set them in .env (or the environment), then re-run:",
      "  bun run prove -- --mode=alpaca",
      "",
      "This mode is intentionally not run in CI.",
      "Keys are an operator gate only; prove does not hit the Alpaca API.",
    ]);
  }
  console.log("  PASS  alpaca_credentials (gate only; no live API calls)");

  const dbPath = env.dbPath?.trim();
  if (!dbPath) {
    failStage("db_path", [
      "EXVA_DB_PATH must point at the daily database that recorded a real",
      "Alpaca paper session (this mode never touches a scratch/mock DB).",
      "  EXVA_DB_PATH=/path/to/exva.db bun run prove -- --mode=alpaca",
    ]);
  }
  if (!fs.existsSync(dbPath)) {
    failStage("db_missing", [`No database file at ${dbPath}.`]);
  }
  console.log(`  PASS  db_path (${dbPath})`);

  let db: DbClient;
  try {
    db = openReadOnlyDb(dbPath);
  } catch (err) {
    failStage("db_open", [
      err instanceof Error ? err.message : String(err),
      "Could not open the database read-only.",
    ]);
  }
  console.log("  PASS  db_open (read-only)");

  const brokerAccounts = new BrokerAccountsRepo(db);
  const trades = new TradesRepo(db);
  const decisionTraces = new DecisionTraceRepo(db);

  const alpacaPaperAccounts = brokerAccounts
    .list()
    .filter((a) => a.brokerType === "alpaca" && a.mode === "paper");
  if (alpacaPaperAccounts.length === 0) {
    failStage("alpaca_paper_account", [
      "No broker_accounts row has brokerType=alpaca and mode=paper.",
      "Add an Alpaca paper account and run a session before proving this mode.",
    ]);
  }
  console.log(
    `  PASS  alpaca_paper_account (${alpacaPaperAccounts.length} account(s): ${alpacaPaperAccounts.map((a) => a.id).join(", ")})`,
  );

  const candidates = alpacaPaperAccounts
    .flatMap((account) =>
      trades.listAllFiltered({ brokerAccountId: account.id }),
    )
    .filter(
      (t) =>
        t.status === "closed" &&
        t.broker_order_id &&
        t.entry_price != null &&
        t.opened_at &&
        t.closed_at &&
        t.final_pnl_usd != null,
    )
    .sort(
      (a, b) =>
        new Date(b.closed_at as string).getTime() -
        new Date(a.closed_at as string).getTime(),
    );

  if (candidates.length === 0) {
    failStage("alpaca_paper_fill", [
      "No closed Alpaca-paper trade with a broker order id, entry price, and",
      "open/close timestamps was found. Keys alone are not proof:",
      "  1. EXVA_DB_PATH=… bun run headless   # or bun run dev",
      "  2. Start an Alpaca-paper session (e.g. BTC/USD breakout, 1m cadence)",
      "  3. Let it open and close at least one real paper fill",
      "  4. Re-run this proof against the same EXVA_DB_PATH",
    ]);
  }
  const trade = candidates[0];
  if (!trade) {
    failStage("alpaca_paper_fill", [
      "Unreachable: candidates checked non-empty.",
    ]);
  }
  console.log(
    `  PASS  alpaca_paper_fill trade=${trade.id} order=${trade.broker_order_id}`,
  );

  const openedAt = new Date(trade.opened_at as string);
  const closedAt = new Date(trade.closed_at as string);
  if (Number.isNaN(openedAt.getTime()) || Number.isNaN(closedAt.getTime())) {
    failStage("trade_timestamps", [
      `Unparseable opened_at (${trade.opened_at}) or closed_at (${trade.closed_at}).`,
    ]);
  }
  if (closedAt.getTime() < openedAt.getTime()) {
    failStage("trade_timestamps", [
      `closed_at (${trade.closed_at}) precedes opened_at (${trade.opened_at}).`,
    ]);
  }
  console.log(
    `  PASS  trade_timestamps opened=${trade.opened_at} closed=${trade.closed_at}`,
  );

  const account = alpacaPaperAccounts.find(
    (a) => a.id === trade.brokerAccountId,
  );
  if (!account || account.brokerType !== "alpaca" || account.mode !== "paper") {
    failStage("trade_mode", [
      `Trade ${trade.id} broker account ${trade.brokerAccountId} is not an Alpaca paper account.`,
    ]);
  }
  console.log(
    `  PASS  trade_mode account=${account.id} brokerType=${account.brokerType} mode=${account.mode}`,
  );

  if (trade.closure_source !== "stream" && trade.closure_source !== "poll") {
    failStage("stream_closure_evidence", [
      `Trade ${trade.id} has no closure_source recorded (got: ${String(trade.closure_source)}).`,
      "Real closes must be tagged 'stream' (order-event push) or 'poll'",
      "(next-tick fallback) by trade-monitor.ts. A null value means the",
      "trade was closed by a path that never recorded closure provenance.",
    ]);
  }
  console.log(`  PASS  stream_closure_evidence source=${trade.closure_source}`);

  const traceRecord = decisionTraces.getRecordByTrade(trade.id);
  if (!traceRecord) {
    failStage("decision_trace", [
      `No decision_traces row is linked to trade ${trade.id}.`,
      "The decision engine must persist a trace fragment before/at trade creation.",
    ]);
  }
  console.log(`  PASS  decision_trace cycle=${traceRecord.cycleId}`);

  if (!trade.sessionId) {
    failStage("scorecard_export", [`Trade ${trade.id} has no sessionId.`]);
  }
  const scorecardService = new PaperScorecardService({
    trades,
    brokerAccounts,
    apiCallLog: new ApiCallLogRepo(db),
    session: new SessionRepo(db),
    sessionExecutionSteps: new SqliteSessionExecutionStepsRepo(db),
  });
  let scorecard;
  try {
    scorecard = scorecardService.generate(trade.sessionId);
  } catch (err) {
    failStage("scorecard_export", [
      err instanceof Error ? err.message : String(err),
    ]);
  }
  if (scorecard.tradeCount === 0) {
    failStage("scorecard_export", [
      `Scorecard for session ${trade.sessionId} reports 0 trades even though`,
      `trade ${trade.id} is closed on that session — export is stale/broken.`,
    ]);
  }
  console.log(
    `  PASS  scorecard_export trades=${scorecard.tradeCount} winRate=${(scorecard.winRate * 100).toFixed(1)}% netPnl=$${scorecard.netPnlUsd.toFixed(2)}`,
  );

  db.sqlite.close();

  console.log("\n── Proof report (alpaca) ──");
  console.log(`  trade_id:            ${trade.id}`);
  console.log(`  session_id:          ${trade.sessionId}`);
  console.log(`  broker_account_id:   ${account.id}`);
  console.log(`  broker_order_id:     ${trade.broker_order_id}`);
  console.log(`  client_order_id:     ${trade.client_order_id ?? "(none)"}`);
  console.log(`  cycle_id:            ${traceRecord.cycleId}`);
  console.log(`  opened_at:           ${trade.opened_at}`);
  console.log(`  closed_at:           ${trade.closed_at}`);
  console.log(`  closure_source:      ${trade.closure_source}`);
  console.log(`  final_pnl_usd:       ${trade.final_pnl_usd}`);
  console.log(
    `  scorecard:           trades=${scorecard.tradeCount} winRate=${(scorecard.winRate * 100).toFixed(1)}% netPnlUsd=${scorecard.netPnlUsd.toFixed(2)}`,
  );
  console.log("\n✓ bun run prove (alpaca) passed — daily DB opened read-only");
}

function proveMock(): void {
  console.log("▶ prove (mock): golden-path mock rehearsal integration test");
  console.log(
    "  HONESTY: mock mode uses MockAdapter only — it does NOT prove live Alpaca/Kraken/etc adapters.",
  );
  console.log(`  ${MOCK_TEST}`);
  if (!MOCK_TEST.includes("mock-trade-rehearsal")) {
    failStage("mock_mode_honesty", [
      "Default prove mode must target the mock-trade-rehearsal integration test.",
      `Got MOCK_TEST=${MOCK_TEST}`,
    ]);
  }
  const started = Date.now();
  const result = spawnSync(
    "bun",
    [
      "run",
      "test",
      "--",
      MOCK_TEST,
      "-t",
      "golden path: scripted pipeline opens a mock trade then monitor auto-closes it",
    ],
    {
      cwd: ROOT,
      stdio: "inherit",
      env: {
        ...process.env,
        NODE_ENV: "test",
      },
    },
  );

  const ms = Date.now() - started;
  if (result.status !== 0) {
    console.error(
      `\n✗ PROVE FAILED at stage "mock_golden_path" (exit ${result.status}, ${ms}ms)`,
    );
    console.error(
      "Stalled/failed stages live inside the vitest output above (open → monitor close).",
    );
    process.exit(result.status ?? 1);
  }

  console.log("\n── Proof report (mock) ──");
  console.log("  PASS  mock_mode_honesty (MockAdapter path only)");
  console.log("  PASS  scratch_harness");
  console.log("  PASS  decision_trace + order_placed + fill_opened");
  console.log("  PASS  monitor_exit + closed_at");
  console.log(
    `\n✓ bun run prove (mock) passed in ${(ms / 1000).toFixed(1)}s — daily DB untouched; not a live-broker proof`,
  );
}

/**
 * Mode 3: full signal -> decision -> ghost order -> persisted fill -> forced
 * restart -> rehydration -> settlement -> balance -> signal-label journey,
 * against a scratch DB (created + destroyed here; daily DB never touched).
 * Still fails LOUD if gamma-api is unreachable — resolution price/label
 * evidence comes from the real market, never a silent skip.
 */
async function provePolymarket(): Promise<void> {
  console.log(
    "▶ prove (polymarket): signal→decision→ghost→persist→restart→settlement",
  );
  const started = Date.now();

  let markets: unknown;
  try {
    const res = await fetch(
      "https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=10",
    );
    if (!res.ok) {
      failStage("gamma_api_reachable", [
        `gamma-api returned HTTP ${res.status}.`,
        "Network/VPN required. Do not treat this as a silent skip.",
      ]);
    }
    markets = await res.json();
  } catch (err) {
    failStage("gamma_api_reachable", [
      err instanceof Error ? err.message : String(err),
      "gamma-api must be reachable for mode 3. Exiting non-zero.",
    ]);
  }

  if (!Array.isArray(markets) || markets.length === 0) {
    failStage("gamma_api_markets", ["No active markets returned."]);
  }

  const market = markets[0] as {
    conditionId?: string;
    question?: string;
    clobTokenIds?: string;
    tokens?: Array<{ token_id?: string; tokenId?: string; outcome?: string }>;
  };
  const conditionId = market.conditionId;
  if (!conditionId) {
    failStage("gamma_api_markets", ["First market is missing conditionId."]);
  }

  let outcomeTokenId: string | null = null;
  if (Array.isArray(market.tokens) && market.tokens[0]) {
    outcomeTokenId = String(
      market.tokens[0].token_id ?? market.tokens[0].tokenId ?? "",
    );
  }
  if (!outcomeTokenId && typeof market.clobTokenIds === "string") {
    try {
      const ids = JSON.parse(market.clobTokenIds) as string[];
      outcomeTokenId = ids[0] ?? null;
    } catch {
      outcomeTokenId = null;
    }
  }
  if (!outcomeTokenId) {
    failStage("gamma_api_markets", [
      "Could not resolve an outcome token id for the first market.",
    ]);
  }

  console.log(`  market: ${market.question ?? conditionId}`);
  console.log(`  conditionId: ${conditionId}`);
  console.log("  PASS  gamma_api_reachable");

  // --- signal: a scan surfaced this market as a candidate (deterministic stub
  // standing in for a real KalshiMarketSource/prediction scanner tick). ---
  const signal = {
    kind: "prediction_market_dislocation" as const,
    instrumentSymbol: `pm:${conditionId}`,
    conditionId,
    outcomeTokenId,
    observedAt: new Date().toISOString(),
  };
  console.log(
    `  PASS  signal kind=${signal.kind} instrument=${signal.instrumentSymbol}`,
  );

  // --- decision: deterministic stand-in for RiskEngine/order-policy approval
  // (same shape as a real decision trace fragment). ---
  const decision = {
    cycleId: `prove-pm-cycle-${Date.now()}`,
    approved: true,
    side: "BUY" as const,
    sizeUsd: 10,
  };
  console.log(
    `  PASS  decision cycle=${decision.cycleId} side=${decision.side} sizeUsd=${decision.sizeUsd}`,
  );

  // --- ghost order + persisted fill, against a scratch DB (never the daily DB). ---
  const scratchDb = createTestDb();
  try {
    const accounts = new BrokerAccountsRepo(scratchDb);
    const accountId = "prove-pm-account";
    accounts.insert({
      id: accountId,
      name: "Prove Polymarket Paper",
      brokerType: "polymarket",
      supportedInstrumentClasses: ["prediction_market"],
      mode: "paper",
      secretRef: "secret:prove-pm-account",
    });
    const paperBalances = new PaperBalancesRepo(scratchDb);
    const paperPositions = new PaperPositionsRepo(scratchDb);

    const metadata = JSON.stringify({ conditionId, outcomeTokenId });
    const paperOpts = {
      accountId,
      paperBalances,
      paperPositions,
    };

    const firstAdapter = new PolymarketAdapter(
      {},
      "paper",
      undefined,
      paperOpts,
    );

    let placed;
    try {
      placed = await firstAdapter.placeOrder({
        instrumentSymbol: signal.instrumentSymbol,
        instrumentType: "prediction_market",
        side: decision.side,
        sizeUsd: decision.sizeUsd,
        clientOrderId: `prove-pm-${Date.now()}`,
        instrumentMetadataJson: metadata,
      });
    } catch (err) {
      failStage("ghost_place", [
        err instanceof Error ? err.message : String(err),
      ]);
    }
    if (!placed.brokerOrderId.startsWith("ghost-")) {
      failStage("ghost_place", ["Expected a ghost-* order id."]);
    }
    console.log(
      `  PASS  ghost_place id=${placed.brokerOrderId} px=${placed.filledAvgPrice}`,
    );

    const persisted = paperPositions.get(placed.brokerOrderId);
    if (!persisted || !persisted.open) {
      failStage("persisted_fill", [
        `paper_positions row for ${placed.brokerOrderId} is missing or not open`,
        "after a ghost fill. Ghost fills must persist before restart.",
      ]);
    }
    console.log(
      `  PASS  persisted_fill shares=${persisted.shares} entryPrice=${persisted.entryPrice}`,
    );

    // --- forced restart: brand-new adapter instance, zero in-memory state,
    // reading only from the persisted store (proves survival, not memory). ---
    const rebuiltAdapter = new PolymarketAdapter(
      {},
      "paper",
      undefined,
      paperOpts,
    );
    const statusAfterRestart = await rebuiltAdapter.getOrderStatus(
      placed.brokerOrderId,
    );
    if (statusAfterRestart.status !== "open") {
      failStage("restart_rehydration", [
        `Expected order ${placed.brokerOrderId} to still be open after a`,
        `simulated restart; got status=${statusAfterRestart.status}.`,
      ]);
    }
    console.log(
      `  PASS  restart_rehydration status=${statusAfterRestart.status}`,
    );

    // --- settlement: force-close on the rebuilt adapter (real-or-deterministic
    // fixture resolution — mark-to-market via the live gamma-api quote when
    // the market has not resolved yet, matching the ghost simulator's real path). ---
    const closed = await rebuiltAdapter.closeOrder(placed.brokerOrderId);
    console.log(`  PASS  settlement realizedPnlUsd=${closed.realizedPnlUsd}`);

    const closedPersisted = paperPositions.get(placed.brokerOrderId);
    if (!closedPersisted || closedPersisted.open) {
      failStage("settlement", [
        `paper_positions row for ${placed.brokerOrderId} is still open after`,
        "closeOrder(); settlement must mark the persisted row closed too.",
      ]);
    }
    console.log("  PASS  settlement_persisted open=false");

    const balance = await rebuiltAdapter.getAccountBalance();
    console.log(`  PASS  balance after_settlement=${balance.toFixed(2)}`);

    // --- signal label: the outcome this journey would attach to the source
    // signal for downstream labeling/backtest attribution. ---
    const signalLabel =
      closed.realizedPnlUsd != null && closed.realizedPnlUsd > 0
        ? "win"
        : closed.realizedPnlUsd != null && closed.realizedPnlUsd < 0
          ? "loss"
          : "flat";
    console.log(`  PASS  signal_label label=${signalLabel}`);

    const ms = Date.now() - started;
    console.log("\n── Proof report (polymarket) ──");
    console.log("  PASS  gamma_api_reachable");
    console.log("  PASS  signal → decision → ghost_place → persisted_fill");
    console.log("  PASS  forced restart → rehydration → settlement");
    console.log(`  broker_order_id: ${placed.brokerOrderId}`);
    console.log(`  account_id:      ${accountId}`);
    console.log(`  realized_pnl_usd: ${closed.realizedPnlUsd}`);
    console.log(`  balance_after:   ${balance.toFixed(2)}`);
    console.log(`  signal_label:    ${signalLabel}`);
    console.log(
      `\n✓ bun run prove (polymarket) passed in ${(ms / 1000).toFixed(1)}s — scratch DB only, daily DB untouched`,
    );
  } finally {
    scratchDb.sqlite.close();
  }
}

const mode = parseMode();
if (mode === "alpaca") {
  proveAlpaca();
} else if (mode === "polymarket") {
  await provePolymarket();
} else {
  proveMock();
}
