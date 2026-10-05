// SQLite access. Every table read/write goes through this file.
import { Database } from "bun:sqlite";
import type {
  Account,
  Backtest,
  Bar,
  Bot,
  Decision,
  DecisionKind,
  EngineEvent,
  EquityPoint,
  Fill,
  Order,
  Trade,
} from "@shared/types.ts";
import init from "./migrations/001_init.sql" with { type: "text" };

const MIGRATIONS = [init];

export function openDb(file: string): Database {
  const db = new Database(file, { create: true, strict: true });
  db.run("PRAGMA foreign_keys = ON");
  db.run("PRAGMA busy_timeout = 5000");
  if (file !== ":memory:") db.run("PRAGMA journal_mode = WAL");
  const { user_version } = db.query("PRAGMA user_version").get() as { user_version: number };
  for (let i = user_version; i < MIGRATIONS.length; i++) {
    db.transaction(() => {
      db.run(MIGRATIONS[i] as string);
      db.run(`PRAGMA user_version = ${i + 1}`);
    })();
  }
  return db;
}

type Row = Record<string, unknown>;
const json = <T>(v: unknown, fallback: T): T =>
  typeof v === "string" ? (JSON.parse(v) as T) : fallback;
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const ACTIVE = "('pending_submit','submitted','partially_filled','submit_unknown')";

const toAccount = (r: Row, hasKeys: boolean): Account => ({
  id: r.id as string,
  name: r.name as string,
  broker: r.broker as Account["broker"],
  mode: r.mode as Account["mode"],
  startingCash: num(r.starting_cash),
  hasKeys,
  createdAt: r.created_at as number,
});

const toBot = (r: Row): Bot => ({
  id: r.id as string,
  name: r.name as string,
  strategyId: r.strategy_id as string,
  params: json(r.params, {}),
  symbols: json(r.symbols, []),
  timeframe: r.timeframe as Bot["timeframe"],
  accountId: r.account_id as string,
  dollarsPerTrade: r.dollars_per_trade as number,
  risk: json(r.risk, {} as Bot["risk"]),
  status: r.status as Bot["status"],
  backtestId: (r.backtest_id as string | null) ?? null,
  createdAt: r.created_at as number,
  updatedAt: r.updated_at as number,
});

const toDecision = (r: Row): Decision => ({
  id: r.id as string,
  botId: r.bot_id as string,
  symbol: r.symbol as string,
  barTs: r.bar_ts as number,
  kind: r.kind as DecisionKind,
  code: r.code as Decision["code"],
  message: r.message as string,
  values: json(r.vals, {}),
  orderId: (r.order_id as string | null) ?? null,
  aiCallId: (r.ai_call_id as string | null) ?? null,
  createdAt: r.created_at as number,
});

export interface OrderRow extends Order {
  refTs: number;
  stopPct: number | null;
  targetPct: number | null;
}

const toOrder = (r: Row): OrderRow => ({
  id: r.id as string,
  clientOrderId: r.client_order_id as string,
  brokerOrderId: (r.broker_order_id as string | null) ?? null,
  botId: r.bot_id as string,
  accountId: r.account_id as string,
  symbol: r.symbol as string,
  side: r.side as Order["side"],
  notional: num(r.notional),
  qty: num(r.qty),
  refTs: r.ref_ts as number,
  status: r.status as Order["status"],
  filledQty: r.filled_qty as number,
  avgFillPrice: num(r.avg_fill_price),
  stopPct: num(r.stop_pct),
  targetPct: num(r.target_pct),
  decisionId: (r.decision_id as string | null) ?? null,
  reason: (r.reason as string | null) ?? null,
  error: (r.error as string | null) ?? null,
  createdAt: r.created_at as number,
  updatedAt: r.updated_at as number,
});

const toTrade = (r: Row): Trade => ({
  id: r.id as string,
  botId: r.bot_id as string,
  accountId: r.account_id as string,
  symbol: r.symbol as string,
  status: r.status as Trade["status"],
  qty: r.qty as number,
  entryPrice: r.entry_price as number,
  exitQty: r.exit_qty as number,
  exitPrice: num(r.exit_price),
  fees: r.fees as number,
  stopPct: num(r.stop_pct),
  targetPct: num(r.target_pct),
  openedAt: r.opened_at as number,
  closedAt: num(r.closed_at),
  pnlUsd: num(r.pnl_usd),
  pnlPct: num(r.pnl_pct),
  exitReason: (r.exit_reason as string | null) ?? null,
  entryOrderId: (r.entry_order_id as string | null) ?? null,
  exitOrderId: (r.exit_order_id as string | null) ?? null,
});

const toEvent = (r: Row): EngineEvent => ({
  id: r.id as number,
  ts: r.ts as number,
  level: r.level as EngineEvent["level"],
  kind: r.kind as string,
  message: r.message as string,
  data: json(r.data, null),
});

export interface AiCallRow {
  id: string;
  ts: number;
  botId: string | null;
  purpose: string;
  model: string;
  promptVersion: string;
  contextHash: string;
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
  ok: boolean;
  error: string | null;
  response: string | null;
}

export class Store {
  /** Bumped on every new fill so derived ledgers can be cached. */
  fillVersion = 0;
  constructor(readonly db: Database) {}

  static open(file: string): Store {
    return new Store(openDb(file));
  }

  tx<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  // ---- settings (key/value JSON) ----
  getJson<T>(key: string): T | null {
    const row = this.db.query("SELECT value FROM settings WHERE key = ?").get(key) as Row | null;
    return row ? (JSON.parse(row.value as string) as T) : null;
  }
  setJson(key: string, value: unknown): void {
    this.db
      .query(
        "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      )
      .run(key, JSON.stringify(value));
  }

  // ---- accounts ----
  listAccounts(hasKeys: (id: string) => boolean = () => false): Account[] {
    const rows = this.db.query("SELECT * FROM accounts ORDER BY created_at").all() as Row[];
    return rows.map((r) => toAccount(r, hasKeys(r.id as string)));
  }
  getAccount(id: string, hasKeys: (id: string) => boolean = () => false): Account | null {
    const r = this.db.query("SELECT * FROM accounts WHERE id = ?").get(id) as Row | null;
    return r ? toAccount(r, hasKeys(id)) : null;
  }
  upsertAccount(a: Omit<Account, "hasKeys">): void {
    this.db
      .query(
        `INSERT INTO accounts (id, name, broker, mode, starting_cash, created_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, starting_cash = excluded.starting_cash`,
      )
      .run(a.id, a.name, a.broker, a.mode, a.startingCash, a.createdAt);
  }

  // ---- bots ----
  listBots(): Bot[] {
    return (this.db.query("SELECT * FROM bots ORDER BY created_at").all() as Row[]).map(toBot);
  }
  getBot(id: string): Bot | null {
    const r = this.db.query("SELECT * FROM bots WHERE id = ?").get(id) as Row | null;
    return r ? toBot(r) : null;
  }
  saveBot(b: Bot): void {
    this.db
      .query(
        `INSERT INTO bots (id, name, strategy_id, params, symbols, timeframe, account_id, dollars_per_trade, risk, status, backtest_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, strategy_id = excluded.strategy_id, params = excluded.params,
           symbols = excluded.symbols, timeframe = excluded.timeframe, account_id = excluded.account_id,
           dollars_per_trade = excluded.dollars_per_trade, risk = excluded.risk, status = excluded.status,
           backtest_id = excluded.backtest_id, updated_at = excluded.updated_at`,
      )
      .run(
        b.id,
        b.name,
        b.strategyId,
        JSON.stringify(b.params),
        JSON.stringify(b.symbols),
        b.timeframe,
        b.accountId,
        b.dollarsPerTrade,
        JSON.stringify(b.risk),
        b.status,
        b.backtestId,
        b.createdAt,
        b.updatedAt,
      );
  }
  deleteBot(id: string): void {
    this.db.query("DELETE FROM bots WHERE id = ?").run(id);
  }

  // ---- bars ----
  upsertBars(symbol: string, timeframe: string, feed: string, bars: Bar[]): void {
    const stmt = this.db.query(
      `INSERT INTO bars (symbol, timeframe, feed, ts, o, h, l, c, v) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(symbol, timeframe, feed, ts) DO UPDATE SET o = excluded.o, h = excluded.h, l = excluded.l, c = excluded.c, v = excluded.v`,
    );
    this.tx(() => {
      for (const b of bars) stmt.run(symbol, timeframe, feed, b.ts, b.o, b.h, b.l, b.c, b.v);
    });
  }
  /** Last `count` bars whose start is < endExclusive, oldest first. */
  barsBefore(
    symbol: string,
    timeframe: string,
    feed: string,
    endExclusive: number,
    count: number,
  ): Bar[] {
    const rows = this.db
      .query(
        "SELECT ts, o, h, l, c, v FROM bars WHERE symbol = ? AND timeframe = ? AND feed = ? AND ts < ? ORDER BY ts DESC LIMIT ?",
      )
      .all(symbol, timeframe, feed, endExclusive, count) as Bar[];
    return rows.reverse();
  }
  barsBetween(
    symbol: string,
    timeframe: string,
    feed: string,
    from: number,
    toExclusive: number,
  ): Bar[] {
    return this.db
      .query(
        "SELECT ts, o, h, l, c, v FROM bars WHERE symbol = ? AND timeframe = ? AND feed = ? AND ts >= ? AND ts < ? ORDER BY ts",
      )
      .all(symbol, timeframe, feed, from, toExclusive) as Bar[];
  }
  lastBarTs(symbol: string, timeframe: string, feed: string): number | null {
    const r = this.db
      .query("SELECT MAX(ts) AS ts FROM bars WHERE symbol = ? AND timeframe = ? AND feed = ?")
      .get(symbol, timeframe, feed) as Row;
    return num(r.ts);
  }
  firstBarTs(symbol: string, timeframe: string, feed: string): number | null {
    const r = this.db
      .query("SELECT MIN(ts) AS ts FROM bars WHERE symbol = ? AND timeframe = ? AND feed = ?")
      .get(symbol, timeframe, feed) as Row;
    return num(r.ts);
  }

  // ---- decisions ----
  /** Returns false when this (bot, symbol, bar) was already decided. */
  insertDecision(d: Decision): boolean {
    const res = this.db
      .query(
        `INSERT OR IGNORE INTO decisions (id, bot_id, symbol, bar_ts, kind, code, message, vals, order_id, ai_call_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        d.id,
        d.botId,
        d.symbol,
        d.barTs,
        d.kind,
        d.code,
        d.message,
        JSON.stringify(d.values),
        d.orderId,
        d.aiCallId,
        d.createdAt,
      );
    return res.changes > 0;
  }
  hasDecision(botId: string, symbol: string, barTs: number): boolean {
    return Boolean(
      this.db
        .query("SELECT 1 FROM decisions WHERE bot_id = ? AND symbol = ? AND bar_ts = ?")
        .get(botId, symbol, barTs),
    );
  }
  getDecision(id: string): Decision | null {
    const r = this.db.query("SELECT * FROM decisions WHERE id = ?").get(id) as Row | null;
    return r ? toDecision(r) : null;
  }
  listDecisions(
    botId: string,
    opts: {
      symbol?: string;
      kinds?: DecisionKind[];
      since?: number;
      before?: number;
      limit?: number;
    } = {},
  ): Decision[] {
    const where = ["bot_id = ?"];
    const args: (string | number)[] = [botId];
    if (opts.symbol) {
      where.push("symbol = ?");
      args.push(opts.symbol);
    }
    if (opts.kinds?.length) {
      where.push(`kind IN (${opts.kinds.map(() => "?").join(",")})`);
      args.push(...opts.kinds);
    }
    if (opts.since !== undefined) {
      where.push("bar_ts >= ?");
      args.push(opts.since);
    }
    if (opts.before !== undefined) {
      where.push("bar_ts < ?");
      args.push(opts.before);
    }
    args.push(opts.limit ?? 200);
    const sql = `SELECT * FROM decisions WHERE ${where.join(" AND ")} ORDER BY bar_ts DESC, symbol LIMIT ?`;
    return (this.db.query(sql).all(...args) as Row[]).map(toDecision);
  }
  decisionCounts(
    botId: string | null,
    since: number,
  ): { code: string; kind: DecisionKind; count: number }[] {
    const sql = `SELECT code, kind, COUNT(*) AS count FROM decisions WHERE bar_ts >= ? ${botId ? "AND bot_id = ?" : ""} GROUP BY code, kind ORDER BY count DESC`;
    const args: (string | number)[] = botId ? [since, botId] : [since];
    return this.db.query(sql).all(...args) as { code: string; kind: DecisionKind; count: number }[];
  }

  // ---- orders ----
  insertOrder(o: OrderRow): void {
    this.db
      .query(
        `INSERT INTO orders (id, client_order_id, broker_order_id, bot_id, account_id, symbol, side, notional, qty, ref_ts, status,
           filled_qty, avg_fill_price, stop_pct, target_pct, decision_id, reason, error, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        o.id,
        o.clientOrderId,
        o.brokerOrderId,
        o.botId,
        o.accountId,
        o.symbol,
        o.side,
        o.notional,
        o.qty,
        o.refTs,
        o.status,
        o.filledQty,
        o.avgFillPrice,
        o.stopPct,
        o.targetPct,
        o.decisionId,
        o.reason,
        o.error,
        o.createdAt,
        o.updatedAt,
      );
  }
  updateOrder(
    id: string,
    patch: Partial<
      Pick<
        OrderRow,
        "brokerOrderId" | "status" | "filledQty" | "avgFillPrice" | "error" | "decisionId"
      >
    >,
    now: number,
  ): void {
    const cols: Record<string, string> = {
      brokerOrderId: "broker_order_id",
      status: "status",
      filledQty: "filled_qty",
      avgFillPrice: "avg_fill_price",
      error: "error",
      decisionId: "decision_id",
    };
    const sets: string[] = [];
    const args: (string | number | null)[] = [];
    for (const [k, v] of Object.entries(patch)) {
      sets.push(`${cols[k]} = ?`);
      args.push(v as string | number | null);
    }
    if (!sets.length) return;
    this.db
      .query(`UPDATE orders SET ${sets.join(", ")}, updated_at = ? WHERE id = ?`)
      .run(...args, now, id);
  }
  getOrder(id: string): OrderRow | null {
    const r = this.db.query("SELECT * FROM orders WHERE id = ?").get(id) as Row | null;
    return r ? toOrder(r) : null;
  }
  getOrderByClientId(clientOrderId: string): OrderRow | null {
    const r = this.db
      .query("SELECT * FROM orders WHERE client_order_id = ?")
      .get(clientOrderId) as Row | null;
    return r ? toOrder(r) : null;
  }
  activeOrders(accountId?: string): OrderRow[] {
    const sql = `SELECT * FROM orders WHERE status IN ${ACTIVE} ${accountId ? "AND account_id = ?" : ""} ORDER BY created_at`;
    return (this.db.query(sql).all(...(accountId ? [accountId] : [])) as Row[]).map(toOrder);
  }
  activeOrderFor(botId: string, symbol: string): OrderRow | null {
    const r = this.db
      .query(`SELECT * FROM orders WHERE bot_id = ? AND symbol = ? AND status IN ${ACTIVE} LIMIT 1`)
      .get(botId, symbol) as Row | null;
    return r ? toOrder(r) : null;
  }
  listOrders(opts: { botId?: string; limit?: number } = {}): OrderRow[] {
    const sql = `SELECT * FROM orders ${opts.botId ? "WHERE bot_id = ?" : ""} ORDER BY created_at DESC LIMIT ?`;
    const args: (string | number)[] = opts.botId
      ? [opts.botId, opts.limit ?? 200]
      : [opts.limit ?? 200];
    return (this.db.query(sql).all(...args) as Row[]).map(toOrder);
  }

  // ---- fills ----
  insertFill(f: Fill): boolean {
    const added =
      this.db
        .query(
          "INSERT OR IGNORE INTO fills (id, order_id, qty, price, fee, ts) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run(f.id, f.orderId, f.qty, f.price, f.fee, f.ts).changes > 0;
    if (added) this.fillVersion++;
    return added;
  }
  /** Signed cash flow and holdings for an account, derived from its fills (used by the simulator). */
  ledger(accountId: string): { cashDelta: number; holdings: Map<string, number> } {
    const rows = this.db
      .query(
        `SELECT o.symbol AS symbol, o.side AS side, SUM(f.qty) AS qty, SUM(f.qty * f.price) AS value, SUM(f.fee) AS fee
         FROM fills f JOIN orders o ON o.id = f.order_id WHERE o.account_id = ? GROUP BY o.symbol, o.side`,
      )
      .all(accountId) as {
      symbol: string;
      side: string;
      qty: number;
      value: number;
      fee: number;
    }[];
    let cashDelta = 0;
    const holdings = new Map<string, number>();
    for (const r of rows) {
      const sign = r.side === "buy" ? 1 : -1;
      cashDelta += -sign * r.value - r.fee;
      holdings.set(r.symbol, (holdings.get(r.symbol) ?? 0) + sign * r.qty);
    }
    return { cashDelta, holdings };
  }
  fillsForOrders(orderIds: string[]): Fill[] {
    if (!orderIds.length) return [];
    return this.db
      .query(
        `SELECT * FROM fills WHERE order_id IN (${orderIds.map(() => "?").join(",")}) ORDER BY ts`,
      )
      .all(...orderIds) as Fill[];
  }

  // ---- trades (an open trade is the position) ----
  openTrade(botId: string, symbol: string): Trade | null {
    const r = this.db
      .query("SELECT * FROM trades WHERE bot_id = ? AND symbol = ? AND status = 'open' LIMIT 1")
      .get(botId, symbol) as Row | null;
    return r ? toTrade(r) : null;
  }
  openTradesOnAccountSymbol(accountId: string, symbol: string): Trade[] {
    return (
      this.db
        .query("SELECT * FROM trades WHERE account_id = ? AND symbol = ? AND status = 'open'")
        .all(accountId, symbol) as Row[]
    ).map(toTrade);
  }
  listTrades(
    opts: {
      botId?: string;
      accountId?: string;
      status?: Trade["status"];
      since?: number;
      limit?: number;
    } = {},
  ): Trade[] {
    const where: string[] = [];
    const args: (string | number)[] = [];
    if (opts.botId) {
      where.push("bot_id = ?");
      args.push(opts.botId);
    }
    if (opts.accountId) {
      where.push("account_id = ?");
      args.push(opts.accountId);
    }
    if (opts.status) {
      where.push("status = ?");
      args.push(opts.status);
    }
    if (opts.since !== undefined) {
      where.push("COALESCE(closed_at, opened_at) >= ?");
      args.push(opts.since);
    }
    args.push(opts.limit ?? 500);
    const sql = `SELECT * FROM trades ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY opened_at DESC LIMIT ?`;
    return (this.db.query(sql).all(...args) as Row[]).map(toTrade);
  }
  getTrade(id: string): Trade | null {
    const r = this.db.query("SELECT * FROM trades WHERE id = ?").get(id) as Row | null;
    return r ? toTrade(r) : null;
  }
  saveTrade(t: Trade): void {
    this.db
      .query(
        `INSERT INTO trades (id, bot_id, account_id, symbol, status, qty, entry_price, exit_qty, exit_price, fees, stop_pct, target_pct,
           opened_at, closed_at, pnl_usd, pnl_pct, exit_reason, entry_order_id, exit_order_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET status = excluded.status, qty = excluded.qty, entry_price = excluded.entry_price,
           exit_qty = excluded.exit_qty, exit_price = excluded.exit_price, fees = excluded.fees, closed_at = excluded.closed_at,
           pnl_usd = excluded.pnl_usd, pnl_pct = excluded.pnl_pct, exit_reason = excluded.exit_reason, exit_order_id = excluded.exit_order_id`,
      )
      .run(
        t.id,
        t.botId,
        t.accountId,
        t.symbol,
        t.status,
        t.qty,
        t.entryPrice,
        t.exitQty,
        t.exitPrice,
        t.fees,
        t.stopPct,
        t.targetPct,
        t.openedAt,
        t.closedAt,
        t.pnlUsd,
        t.pnlPct,
        t.exitReason,
        t.entryOrderId,
        t.exitOrderId,
      );
  }
  realizedPnlSince(botId: string, since: number): number {
    const r = this.db
      .query(
        "SELECT COALESCE(SUM(pnl_usd), 0) AS pnl FROM trades WHERE bot_id = ? AND status = 'closed' AND closed_at >= ?",
      )
      .get(botId, since) as Row;
    return Number(r.pnl);
  }

  // ---- equity ----
  insertEquity(accountId: string, p: EquityPoint): void {
    this.db
      .query("INSERT OR REPLACE INTO equity (account_id, ts, equity, cash) VALUES (?, ?, ?, ?)")
      .run(accountId, p.ts, p.equity, p.cash);
  }
  equitySeries(accountId: string, from: number, to: number): EquityPoint[] {
    return this.db
      .query(
        "SELECT ts, equity, cash FROM equity WHERE account_id = ? AND ts >= ? AND ts <= ? ORDER BY ts",
      )
      .all(accountId, from, to) as EquityPoint[];
  }

  // ---- backtests ----
  saveBacktest(b: Backtest): void {
    const result = JSON.stringify({
      trades: b.trades,
      equity: b.equity,
      fills: b.fills,
      decisionCounts: b.decisionCounts,
    });
    this.db
      .query(
        `INSERT INTO backtests (id, created_at, status, spec, metrics, result, error) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET status = excluded.status, metrics = excluded.metrics, result = excluded.result, error = excluded.error`,
      )
      .run(
        b.id,
        b.createdAt,
        b.status,
        JSON.stringify(b.spec),
        JSON.stringify(b.metrics),
        result,
        b.error,
      );
  }
  getBacktest(id: string): Backtest | null {
    const r = this.db.query("SELECT * FROM backtests WHERE id = ?").get(id) as Row | null;
    if (!r) return null;
    const result = json(r.result, { trades: [], equity: [], fills: [], decisionCounts: [] });
    return {
      id: r.id as string,
      createdAt: r.created_at as number,
      status: r.status as Backtest["status"],
      spec: json(r.spec, {} as Backtest["spec"]),
      metrics: json(r.metrics, null),
      ...result,
      error: (r.error as string | null) ?? null,
    };
  }
  listBacktests(limit = 50): Omit<Backtest, "trades" | "equity" | "fills" | "decisionCounts">[] {
    const rows = this.db
      .query(
        "SELECT id, created_at, status, spec, metrics, error FROM backtests ORDER BY created_at DESC LIMIT ?",
      )
      .all(limit) as Row[];
    return rows.map((r) => ({
      id: r.id as string,
      createdAt: r.created_at as number,
      status: r.status as Backtest["status"],
      spec: json(r.spec, {} as Backtest["spec"]),
      metrics: json(r.metrics, null),
      error: (r.error as string | null) ?? null,
    }));
  }

  // ---- ai calls ----
  insertAiCall(c: AiCallRow): void {
    this.db
      .query(
        `INSERT INTO ai_calls (id, ts, bot_id, purpose, model, prompt_version, context_hash, input_tokens, cached_tokens, output_tokens,
           cost_usd, latency_ms, ok, error, response) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        c.id,
        c.ts,
        c.botId,
        c.purpose,
        c.model,
        c.promptVersion,
        c.contextHash,
        c.inputTokens,
        c.cachedTokens,
        c.outputTokens,
        c.costUsd,
        c.latencyMs,
        c.ok ? 1 : 0,
        c.error,
        c.response,
      );
  }
  cachedAiCall(
    purpose: string,
    model: string,
    promptVersion: string,
    contextHash: string,
  ): AiCallRow | null {
    const r = this.db
      .query(
        "SELECT * FROM ai_calls WHERE purpose = ? AND model = ? AND prompt_version = ? AND context_hash = ? AND ok = 1 ORDER BY ts DESC LIMIT 1",
      )
      .get(purpose, model, promptVersion, contextHash) as Row | null;
    return r ? this.toAiCall(r) : null;
  }
  getAiCall(id: string): AiCallRow | null {
    const r = this.db.query("SELECT * FROM ai_calls WHERE id = ?").get(id) as Row | null;
    return r ? this.toAiCall(r) : null;
  }
  aiSpendSince(since: number, excludePurpose = "backtest"): number {
    const r = this.db
      .query(
        "SELECT COALESCE(SUM(cost_usd), 0) AS cost FROM ai_calls WHERE ts >= ? AND purpose != ?",
      )
      .get(since, excludePurpose) as Row;
    return Number(r.cost);
  }
  aiCallCountSince(botId: string, since: number): number {
    const r = this.db
      .query(
        "SELECT COUNT(*) AS n FROM ai_calls WHERE bot_id = ? AND ts >= ? AND purpose = 'analyst'",
      )
      .get(botId, since) as Row;
    return Number(r.n);
  }
  private toAiCall(r: Row): AiCallRow {
    return {
      id: r.id as string,
      ts: r.ts as number,
      botId: (r.bot_id as string | null) ?? null,
      purpose: r.purpose as string,
      model: r.model as string,
      promptVersion: r.prompt_version as string,
      contextHash: r.context_hash as string,
      inputTokens: r.input_tokens as number,
      cachedTokens: r.cached_tokens as number,
      outputTokens: r.output_tokens as number,
      costUsd: r.cost_usd as number,
      latencyMs: r.latency_ms as number,
      ok: Boolean(r.ok),
      error: (r.error as string | null) ?? null,
      response: (r.response as string | null) ?? null,
    };
  }

  // ---- events ----
  addEvent(
    ts: number,
    level: EngineEvent["level"],
    kind: string,
    message: string,
    data?: Record<string, unknown>,
  ): EngineEvent {
    const res = this.db
      .query("INSERT INTO events (ts, level, kind, message, data) VALUES (?, ?, ?, ?, ?)")
      .run(ts, level, kind, message, data ? JSON.stringify(data) : null);
    return { id: Number(res.lastInsertRowid), ts, level, kind, message, data: data ?? null };
  }
  listEvents(opts: { since?: number; kind?: string; limit?: number } = {}): EngineEvent[] {
    const where: string[] = [];
    const args: (string | number)[] = [];
    if (opts.since !== undefined) {
      where.push("ts >= ?");
      args.push(opts.since);
    }
    if (opts.kind) {
      where.push("kind = ?");
      args.push(opts.kind);
    }
    args.push(opts.limit ?? 100);
    const sql = `SELECT * FROM events ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY ts DESC, id DESC LIMIT ?`;
    return (this.db.query(sql).all(...args) as Row[]).map(toEvent);
  }
}
