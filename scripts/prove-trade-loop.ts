#!/usr/bin/env bun
/**
 * Doc 04 T2 + Doc 05 T6 — Automated proof harness for the trade loop.
 *
 * Modes:
 *   mock (default) — golden-path mock rehearsal integration test (scratch harness)
 *   alpaca         — requires ALPACA keys; fails loud without a real paper fill
 *   polymarket     — mode 3: gamma-api reachable + Polymarket ghost paper
 *                    place → fill → forced-close path (no CLOB posting)
 *
 * Usage:
 *   bun run prove
 *   bun run prove -- --mode=mock
 *   bun run prove -- --mode=alpaca
 *   bun run prove -- --mode=polymarket
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { env } from "../electron/main/config/env";
import { PolymarketAdapter } from "../electron/main/services/broker/adapters/polymarket-adapter";

const ROOT = path.join(import.meta.dir, "..");

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

function proveAlpaca(): never {
  const key = env.alpacaApiKey ?? process.env.ALPACA_API_KEY?.trim();
  const secret = env.alpacaSecretKey ?? process.env.ALPACA_SECRET_KEY?.trim();
  if (!key || !secret) {
    console.error(
      [
        '✗ PROVE FAILED at stage "alpaca_credentials":',
        "Alpaca paper mode requires ALPACA_API_KEY and ALPACA_SECRET_KEY.",
        "Set them in .env (or the environment), then re-run:",
        "  bun run prove -- --mode=alpaca",
        "",
        "This mode is intentionally not run in CI.",
      ].join("\n"),
    );
    process.exit(1);
  }

  console.error(
    [
      "✓ Alpaca credentials present.",
      "",
      '✗ PROVE FAILED at stage "alpaca_paper_fill":',
      "Keys alone are not G1. Run a real Alpaca-paper BTC session on the daily DB:",
      "  1. EXVA_DB_PATH=… bun run headless   # or bun run dev",
      "  2. Start BTC/USD breakout paper session (1m cadence, loosened thresholds)",
      "  3. Confirm trades.opened_at + closed_at for ≥1 Alpaca paper fill",
      "  4. Export first-week baseline scorecard; attach to 04 PROGRESS",
      "",
      "Exiting non-zero so scripts never silently claim G1.",
    ].join("\n"),
  );
  process.exit(1);
}

function proveMock(): void {
  console.log("▶ prove (mock): golden-path mock rehearsal integration test");
  console.log(`  ${MOCK_TEST}`);
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
  console.log("  PASS  scratch_harness");
  console.log("  PASS  decision_trace + order_placed + fill_opened");
  console.log("  PASS  monitor_exit + closed_at");
  console.log(
    `\n✓ bun run prove (mock) passed in ${(ms / 1000).toFixed(1)}s — daily DB untouched`,
  );
}

/**
 * Mode 3: live gamma-api + Polymarket ghost paper path.
 * Fails LOUD if gamma-api is unreachable (never silent skip).
 */
async function provePolymarket(): Promise<void> {
  console.log("▶ prove (polymarket): gamma-api + ghost paper place→fill→close");
  const started = Date.now();

  let markets: unknown;
  try {
    const res = await fetch(
      "https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=10",
    );
    if (!res.ok) {
      console.error(
        [
          '✗ PROVE FAILED at stage "gamma_api_reachable":',
          `gamma-api returned HTTP ${res.status}.`,
          "Network/VPN required. Do not treat this as a silent skip.",
        ].join("\n"),
      );
      process.exit(1);
    }
    markets = await res.json();
  } catch (err) {
    console.error(
      [
        '✗ PROVE FAILED at stage "gamma_api_reachable":',
        err instanceof Error ? err.message : String(err),
        "gamma-api must be reachable for mode 3. Exiting non-zero.",
      ].join("\n"),
    );
    process.exit(1);
  }

  if (!Array.isArray(markets) || markets.length === 0) {
    console.error(
      '✗ PROVE FAILED at stage "gamma_api_markets": no active markets returned.',
    );
    process.exit(1);
  }

  const market = markets[0] as {
    conditionId?: string;
    question?: string;
    clobTokenIds?: string;
    tokens?: Array<{ token_id?: string; tokenId?: string; outcome?: string }>;
  };
  const conditionId = market.conditionId;
  if (!conditionId) {
    console.error(
      '✗ PROVE FAILED at stage "gamma_api_markets": first market missing conditionId.',
    );
    process.exit(1);
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
    console.error(
      '✗ PROVE FAILED at stage "gamma_api_markets": could not resolve outcome token id.',
    );
    process.exit(1);
  }

  console.log(`  market: ${market.question ?? conditionId}`);
  console.log(`  conditionId: ${conditionId}`);

  // Dummy credentials — paper mode never posts to CLOB / never signs.
  const adapter = new PolymarketAdapter(
    {
      privateKey:
        "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      funderAddress: "0x0000000000000000000000000000000000000001",
    },
    "paper",
    undefined,
    { startingPaperBalanceUsd: 1_000 },
  );

  const metadata = JSON.stringify({
    conditionId,
    outcomeTokenId,
  });

  let placed;
  try {
    placed = await adapter.placeOrder({
      instrumentSymbol: `pm:${conditionId}`,
      instrumentType: "prediction_market",
      side: "BUY",
      sizeUsd: 10,
      clientOrderId: `prove-pm-${Date.now()}`,
      instrumentMetadataJson: metadata,
    });
  } catch (err) {
    console.error(
      [
        '✗ PROVE FAILED at stage "ghost_place":',
        err instanceof Error ? err.message : String(err),
      ].join("\n"),
    );
    process.exit(1);
  }

  if (!placed.brokerOrderId.startsWith("ghost-")) {
    console.error(
      '✗ PROVE FAILED at stage "ghost_place": expected ghost-* order id.',
    );
    process.exit(1);
  }
  console.log(
    `  PASS  ghost_place id=${placed.brokerOrderId} px=${placed.filledAvgPrice}`,
  );

  const status = await adapter.getOrderStatus(placed.brokerOrderId);
  if (status.status !== "open" && status.status !== "closed") {
    console.error(
      `✗ PROVE FAILED at stage "ghost_status": unexpected status ${status.status}`,
    );
    process.exit(1);
  }
  console.log(`  PASS  ghost_status status=${status.status}`);

  const closed = await adapter.closeOrder(placed.brokerOrderId);
  console.log(
    `  PASS  ghost_forced_close realizedPnlUsd=${closed.realizedPnlUsd}`,
  );

  const balance = await adapter.getAccountBalance();
  console.log(`  PASS  paper_balance_after=${balance.toFixed(2)}`);

  const ms = Date.now() - started;
  console.log("\n── Proof report (polymarket) ──");
  console.log("  PASS  gamma_api_reachable");
  console.log("  PASS  ghost_place + fill");
  console.log("  PASS  forced_close path");
  console.log(
    `\n✓ bun run prove (polymarket) passed in ${(ms / 1000).toFixed(1)}s`,
  );
  console.log(
    "\nNote: multi-day paper session evidence (real dislocation → resolution)",
    "\nstill requires Ken's overnight prediction session — see 05 PROGRESS.",
  );
}

const mode = parseMode();
if (mode === "alpaca") {
  proveAlpaca();
} else if (mode === "polymarket") {
  void provePolymarket();
} else {
  proveMock();
}
