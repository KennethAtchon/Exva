#!/usr/bin/env bun
// exva <command>. The engine runs headless with `exva run`; everything else reads or changes the same database.
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { reasonText } from "@shared/reasons.ts";
import { backtestInputSchema, botInputSchema } from "@shared/schemas.ts";
import type { Bot, Timeframe } from "@shared/types.ts";
import { startApi } from "./api/server.ts";
import { DEFAULT_PORT, paths, readEngineFile } from "./config.ts";
import { UsEquityCalendar } from "./core/calendar.ts";
import { AlpacaData } from "./data/alpaca-data.ts";
import { SyntheticData } from "./data/synthetic.ts";
import { Engine } from "./engine.ts";
import { STRATEGIES } from "./strategies/index.ts";
import { errorMessage, fmtNum, hhmm, round, usd } from "./util.ts";

const args = process.argv.slice(2);
const command = args[0] ?? "help";
const positional = args
  .slice(1)
  .filter((a, i, all) => !a.startsWith("--") && !(all[i - 1] ?? "").startsWith("--"));
const flag = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return undefined;
  const next = args[i + 1];
  return next && !next.startsWith("--") ? next : "true";
};
const params = (): Record<string, unknown> =>
  Object.fromEntries(
    args
      .flatMap((a, i) => (a === "--param" ? [args[i + 1] ?? ""] : []))
      .map((kv) => {
        const [k, v = ""] = kv.split("=");
        return [
          k,
          v === "true" ? true : v === "false" ? false : Number.isNaN(Number(v)) ? v : Number(v),
        ];
      }),
  );

const table = (rows: (string | number)[][]) => {
  const widths =
    rows[0]?.map((_, c) => Math.max(...rows.map((r) => String(r[c] ?? "").length))) ?? [];
  for (const r of rows) console.log(r.map((v, c) => String(v).padEnd(widths[c] ?? 0)).join("  "));
};
const when = (ts: number) => `${new Date(ts).toISOString().slice(5, 10)} ${hhmm(ts)}`;

function findBot(engine: Engine, ref?: string): Bot {
  const bots = engine.listBots();
  const bot = bots.find((b) => b.id === ref || b.name.toLowerCase() === ref?.toLowerCase());
  if (!bot) {
    console.error(`No bot "${ref ?? ""}". Bots: ${bots.map((b) => b.name).join(", ") || "(none)"}`);
    process.exit(1);
  }
  return bot;
}

async function run() {
  const demo = flag("demo") === "true";
  const port = Number(flag("port") ?? DEFAULT_PORT);
  const p = paths();
  const existing = readEngineFile(p.engineFile);
  if (existing && existing.pid !== process.pid) {
    const alive = await fetch(`http://127.0.0.1:${existing.port}/api/status`, {
      headers: { authorization: `Bearer ${existing.token}` },
      signal: AbortSignal.timeout(1500),
    }).then(
      (r) => r.ok,
      () => false,
    );
    if (alive) {
      console.log(
        `Exva engine already running (pid ${existing.pid}) at http://127.0.0.1:${existing.port}`,
      );
      process.exit(0);
    }
  }
  const engine = new Engine({ demo });
  const token = process.env.EXVA_TOKEN ?? crypto.randomUUID();
  const uiDir = flag("ui") ?? process.env.EXVA_UI_DIR ?? join(import.meta.dir, "../../ui/dist");
  const server = startApi(engine, { port, token, uiDir });
  writeFileSync(
    p.engineFile,
    JSON.stringify({ pid: process.pid, port, token, mode: engine.mode, startedAt: Date.now() }),
    { mode: 0o600 },
  );
  await engine.start();
  console.log(`Exva ${engine.mode} engine running at http://127.0.0.1:${port}/?token=${token}`);
  const shutdown = () => {
    engine.stop();
    server.stop();
    if (readEngineFile(p.engineFile)?.pid === process.pid) rmSync(p.engineFile, { force: true });
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

function status(engine: Engine) {
  const s = engine.status();
  console.log(`Health: ${s.health.toUpperCase()}${s.killSwitch ? "  (KILL SWITCH ON)" : ""}`);
  for (const a of s.accounts)
    console.log(
      `  ${a.ok ? "✓" : "✗"} ${a.name}: ${a.message}${a.equity ? `, ${usd(a.equity)}` : ""}`,
    );
  console.log(`  ${s.data.ok ? "✓" : "✗"} Data: ${s.data.message}`);
  console.log(
    `  ${s.ai.configured ? "✓" : "–"} AI: ${s.ai.configured ? `${s.ai.model}, ${usd(s.ai.spentTodayUsd)} of ${usd(s.ai.budgetUsd)} today` : "no key"}`,
  );
  console.log(
    `  Stocks ${s.market.stocksOpen ? "open" : `closed (opens ${s.market.nextOpen ? when(s.market.nextOpen) : "?"})`}, crypto always open`,
  );
  for (const g of s.sleepGaps) console.log(`  ! Not running ${when(g.from)} → ${when(g.to)}`);
  console.log("");
  for (const bot of engine.listBots()) {
    const sum = engine.summary(bot.id);
    console.log(
      `${bot.status === "running" ? "●" : "○"} ${bot.name}  (${bot.strategyId}, ${bot.symbols.join(" ")}, ${bot.timeframe})`,
    );
    console.log(
      `  Today: ${sum.checks} checks · ${sum.counts.buy} buys · ${sum.counts.sell} sells · ${sum.counts.hold} holds · ${sum.counts.skip} skips · ${sum.counts.error} errors · ${sum.tradesToday} trades · ${usd(sum.pnlToday)}`,
    );
    for (const c of sum.byCode.slice(0, 4))
      console.log(
        `    ${String(c.count).padStart(5)}  ${c.kind.toUpperCase()} ${reasonText(c.code)}`,
      );
    if (sum.closest)
      console.log(
        `  Closest to trading: ${sum.closest.symbol} at ${hhmm(sum.closest.barTs)}: ${sum.closest.message}`,
      );
    if (sum.lastDecision)
      console.log(
        `  Last: ${when(sum.lastDecision.barTs)} ${sum.lastDecision.symbol} ${sum.lastDecision.kind.toUpperCase()}: ${sum.lastDecision.message}`,
      );
    if (sum.sleepingUntil) console.log(`  Sleeping until ${when(sum.sleepingUntil)}`);
    else if (sum.nextCheckAt) console.log(`  Next check ${when(sum.nextCheckAt)}`);
  }
}

async function backtest(engine: Engine) {
  const [strategyId, symbols, timeframe] = positional;
  if (!strategyId || !symbols || !timeframe) {
    console.error(
      "Usage: exva backtest <strategy> <SYMBOL,SYMBOL> <5m|15m|1h> [--days 30] [--param key=value] [--synthetic]",
    );
    process.exit(1);
  }
  const input = backtestInputSchema.parse({
    strategyId,
    symbols: symbols.split(","),
    timeframe,
    days: Number(flag("days") ?? 30),
    params: params(),
    dollarsPerTrade: Number(flag("usd") ?? 1000),
    risk: {
      stopLossPct: null,
      takeProfitPct: null,
      maxHoldBars: null,
      maxPositions: 10,
      dailyLossLimitUsd: 0,
    },
  });
  const bt = await engine.backtest(engine.backtestSpec(input));
  const m = bt.metrics;
  if (!m) return;
  console.log(`${strategyId} on ${input.symbols.join(", ")} ${timeframe}, ${m.days} days`);
  table([
    [
      "Net P&L",
      `${usd(m.netPnl)} (${m.netPnlPct}%)`,
      "Trades",
      `${m.trades} (${m.tradesPerDay}/day)`,
    ],
    [
      "Win rate",
      m.winRate === null ? "–" : `${m.winRate}%`,
      "Profit factor",
      String(m.profitFactor ?? "–"),
    ],
    [
      "Max drawdown",
      `${usd(m.maxDrawdown)} (${m.maxDrawdownPct}%)`,
      "Sharpe",
      String(m.sharpe ?? "–"),
    ],
    [
      "Buy & hold",
      m.buyHoldPct === null ? "–" : `${m.buyHoldPct}%`,
      "Time in market",
      `${m.exposurePct}%`,
    ],
  ]);
  if (m.trades < 30) console.log("Too few trades to judge the strategy.");
  console.log("");
  const rows = bt.trades
    .slice(-15)
    .map((t) => [
      t.symbol,
      when(t.openedAt),
      fmtNum(t.entryPrice),
      t.closedAt ? when(t.closedAt) : "open",
      t.exitPrice ? fmtNum(t.exitPrice) : "",
      t.pnlUsd === null ? "" : usd(t.pnlUsd),
    ]);
  table([["Symbol", "Opened", "Entry", "Closed", "Exit", "P&L"], ...rows]);
}

async function doctor(engine: Engine) {
  let ok = true;
  const check = (pass: boolean, text: string) => {
    ok &&= pass;
    console.log(`${pass ? "✓" : "✗"} ${text}`);
  };
  const accounts = engine.listAccounts();
  check(
    accounts.length > 0,
    accounts.length
      ? `${accounts.length} account(s)`
      : "No accounts. Add one: exva account add-alpaca --key ... --secret ...",
  );
  for (const a of accounts) {
    const r = await engine.testAccount(a.id);
    check(r.ok, `${a.name}: ${r.message}`);
  }
  const data = new AlpacaData({
    keys: () => engine.brokers.dataKeys(),
    stockFeed: () => engine.settings.get().data.stockFeed,
  });
  const now = Date.now();
  for (const symbol of ["BTC/USD", "SPY"]) {
    try {
      const bars =
        (await data.fetchBars([symbol], "15m", now - 5 * 86_400_000, now)).get(symbol) ?? [];
      const last = bars.at(-1);
      check(
        bars.length > 0,
        `${symbol} data: ${bars.length} bars, latest ${last ? when(last.ts) : "none"}`,
      );
    } catch (err) {
      check(false, `${symbol} data: ${errorMessage(err)}`);
    }
  }
  const s = engine.settings.get();
  console.log(
    `${s.ai.hasKey ? "✓" : "–"} AI: ${s.ai.hasKey ? `${s.ai.model} at ${s.ai.baseUrl}` : "no key (optional)"}`,
  );
  process.exit(ok ? 0 : 1);
}

async function paperSmoke(engine: Engine) {
  const symbol = flag("symbol") ?? "BTC/USD";
  const usdAmount = Number(flag("usd") ?? 10);
  const account = engine
    .listAccounts()
    .find((a) => a.broker === "alpaca" && (!flag("account") || a.name === flag("account")));
  if (!account) {
    console.error(
      "No Alpaca account. Add one first: exva account add-alpaca --key ... --secret ...",
    );
    process.exit(1);
  }
  let bot = engine
    .listBots()
    .find((b) => b.name === "Paper smoke test" && b.accountId === account.id);
  bot ??= engine.createBot(
    botInputSchema.parse({
      name: "Paper smoke test",
      strategyId: "heartbeat",
      symbols: [symbol],
      timeframe: "5m",
      accountId: account.id,
      dollarsPerTrade: Math.max(10, usdAmount),
      risk: {
        stopLossPct: null,
        takeProfitPct: null,
        maxHoldBars: null,
        maxPositions: 1,
        dailyLossLimitUsd: 0,
      },
    }),
  ).bot;
  const waitFilled = async (id: string) => {
    for (let i = 0; i < 60; i++) {
      await engine.orders.sync(account.id);
      const o = engine.store.getOrder(id);
      if (o && ["filled", "canceled", "rejected", "expired"].includes(o.status)) return o;
      await Bun.sleep(1000);
    }
    return engine.store.getOrder(id);
  };
  console.log(`Buying ${usd(usdAmount)} of ${symbol} on ${account.name}...`);
  const buy = await waitFilled(
    (
      await engine.orders.submit({
        bot,
        symbol,
        side: "buy",
        notional: usdAmount,
        refTs: Date.now(),
        decisionId: null,
        reason: "paper_smoke",
      })
    ).id,
  );
  console.log(
    `  order ${buy?.clientOrderId} → broker ${buy?.brokerOrderId}: ${buy?.status} ${buy?.filledQty} @ ${buy?.avgFillPrice}`,
  );
  const trade = engine.store.openTrade(bot.id, symbol);
  if (!trade) {
    console.error(`✗ No open position after the buy (${buy?.error ?? buy?.status}).`);
    process.exit(1);
  }
  const pos = (await engine.brokers.get(account.id).positions()).find(
    (p) => p.symbol.replace("/", "") === symbol.replace("/", ""),
  );
  const qty = Math.min(trade.qty, pos?.qty ?? trade.qty);
  console.log(`Selling ${qty} ${symbol}...`);
  const sell = await waitFilled(
    (
      await engine.orders.submit({
        bot,
        symbol,
        side: "sell",
        qty,
        refTs: Date.now(),
        decisionId: null,
        reason: "paper_smoke",
      })
    ).id,
  );
  console.log(
    `  order ${sell?.clientOrderId} → broker ${sell?.brokerOrderId}: ${sell?.status} ${sell?.filledQty} @ ${sell?.avgFillPrice}`,
  );
  const closed = engine.store.getTrade(trade.id);
  console.log(
    closed?.status === "closed"
      ? `✓ Round trip recorded: P&L ${usd(closed.pnlUsd ?? 0)}. Check app.alpaca.markets for the same client order ids.`
      : `✗ Trade still ${closed?.status}`,
  );
  process.exit(closed?.status === "closed" ? 0 : 1);
}

async function main() {
  if (command === "run") return run();
  const engine = new Engine({
    demo: flag("demo") === "true",
    provider: flag("synthetic") === "true" ? new SyntheticData(new UsEquityCalendar()) : undefined,
  });
  switch (command) {
    case "status":
      return status(engine);
    case "bots":
      return table([
        ["Name", "Status", "Strategy", "Symbols", "TF", "$/trade"],
        ...engine
          .listBots()
          .map((b) => [
            b.name,
            b.status,
            b.strategyId,
            b.symbols.join(","),
            b.timeframe,
            b.dollarsPerTrade,
          ]),
      ]);
    case "decisions": {
      const bot = findBot(engine, flag("bot") ?? positional[0]);
      const rows = engine.store
        .listDecisions(bot.id, { limit: Number(flag("limit") ?? 25) })
        .map((d) => [when(d.barTs), d.symbol, d.kind.toUpperCase(), d.message]);
      return table([["Bar", "Symbol", "Kind", "Why"], ...rows]);
    }
    case "trades": {
      const botId = flag("bot") ? findBot(engine, flag("bot")).id : undefined;
      const rows = engine
        .withMarks(engine.store.listTrades({ botId, limit: Number(flag("limit") ?? 25) }))
        .map((t) => [
          engine.store.getBot(t.botId)?.name ?? t.botId,
          t.symbol,
          t.status,
          when(t.openedAt),
          fmtNum(t.entryPrice),
          t.exitPrice ? fmtNum(t.exitPrice) : "",
          t.status === "open" ? `${usd(t.unrealizedPnl ?? 0)} open` : usd(t.pnlUsd ?? 0),
          t.entryOrderId ? (engine.store.getOrder(t.entryOrderId)?.clientOrderId ?? "") : "",
        ]);
      return table([
        ["Bot", "Symbol", "Status", "Opened", "Entry", "Exit", "P&L", "Client order id"],
        ...rows,
      ]);
    }
    case "account": {
      const sub = positional[0];
      if (sub === "add-alpaca") {
        const a = engine.saveAccount({
          name: flag("name") ?? "Alpaca Paper",
          broker: "alpaca",
          keyId: flag("key"),
          secretKey: flag("secret"),
        });
        const r = await engine.testAccount(a.id);
        return console.log(`${r.ok ? "✓" : "✗"} ${a.name} (${a.id}): ${r.message}`);
      }
      if (sub === "add-sim") {
        const a = engine.saveAccount({
          name: flag("name") ?? "Simulator",
          broker: "sim",
          startingCash: Number(flag("cash") ?? 100_000),
        });
        return console.log(`✓ ${a.name} (${a.id})`);
      }
      return table([
        ["Id", "Name", "Broker", "Keys"],
        ...engine
          .listAccounts()
          .map((a) => [
            a.id,
            a.name,
            a.broker,
            a.broker === "sim" ? "–" : a.hasKeys ? "yes" : "NO",
          ]),
      ]);
    }
    case "bot": {
      const sub = positional[0];
      if (sub === "create") {
        const accountRef = flag("account");
        const account =
          engine.listAccounts().find((a) => a.id === accountRef || a.name === accountRef) ??
          engine.listAccounts()[0];
        if (!account) throw new Error("Add an account first");
        const strategy = STRATEGIES.find((s) => s.id === flag("strategy")) ?? STRATEGIES[0];
        const { bot, warnings } = engine.createBot(
          botInputSchema.parse({
            name: flag("name") ?? strategy?.name,
            strategyId: strategy?.id,
            params: params(),
            symbols: (flag("symbols") ?? strategy?.defaultSymbols.join(",") ?? "").split(","),
            timeframe: (flag("timeframe") ?? strategy?.defaultTimeframe) as Timeframe,
            accountId: account.id,
            dollarsPerTrade: Number(flag("usd") ?? 1000),
            risk: {
              stopLossPct: null,
              takeProfitPct: null,
              maxHoldBars: null,
              maxPositions: 10,
              dailyLossLimitUsd: Number(flag("daily-loss") ?? 200),
            },
          }),
        );
        for (const w of warnings) console.log(`! ${w}`);
        if (flag("start") === "true") await engine.startBot(bot.id);
        return console.log(
          `✓ ${bot.name} (${bot.id}) ${flag("start") === "true" ? "started" : "created, run: exva bot start"}`,
        );
      }
      const bot = findBot(engine, positional[1]);
      if (sub === "start") return console.log(`✓ Started ${(await engine.startBot(bot.id)).name}`);
      if (sub === "stop")
        return console.log(
          `✓ Stopped ${(await engine.stopBot(bot.id, flag("close") === "true")).name}`,
        );
      throw new Error("Usage: exva bot create|start|stop");
    }
    case "backtest":
      return backtest(engine);
    case "doctor":
      return doctor(engine);
    case "paper-smoke":
      return paperSmoke(engine);
    case "kill":
      engine.setKillSwitch(positional[0] !== "off");
      return console.log(`Kill switch ${positional[0] === "off" ? "off" : "ON"}`);
    default:
      console.log(`exva — paper-trading engine

  exva run [--demo] [--port 7420]        start the engine (and serve the UI)
  exva status                            health and today's numbers per bot
  exva bots | decisions --bot NAME | trades [--bot NAME]
  exva account add-alpaca --key K --secret S [--name N] | add-sim [--cash 100000]
  exva bot create --strategy ID --symbols A,B --timeframe 15m [--usd 1000] [--param k=v] [--start]
  exva bot start NAME | bot stop NAME [--close]
  exva backtest STRATEGY SYM,SYM 15m [--days 30] [--param k=v] [--synthetic]
  exva doctor                            check keys, broker and data (places nothing)
  exva paper-smoke [--symbol BTC/USD] [--usd 10]   one real paper round trip
  exva kill [off]                        kill switch

Data: ${existsSync(paths().db) ? paths().db : "(no database yet)"}`);
  }
}

main().catch((err) => {
  console.error(`✗ ${errorMessage(err)}`);
  process.exit(1);
});
