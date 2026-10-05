// AI outside the trading loop: the morning Journal, Explain, and the read-only Assistant.
import { reasonText } from "@shared/reasons.ts";
import type { AssistantMessage } from "@shared/schemas.ts";
import { backtestInputSchema } from "@shared/schemas.ts";
import type { Journal, Proposal } from "@shared/types.ts";
import type { Engine } from "../engine.ts";
import { InputError } from "../errors.ts";
import { getStrategy, STRATEGIES, strategyInfo } from "../strategies/index.ts";
import { errorMessage, localDateKey, round, sha256, usd } from "../util.ts";
import { type ChatMessage, promptVersion, type ToolDef } from "./client.ts";
import assistantPrompt from "./prompts/assistant.md" with { type: "text" };
import explainPrompt from "./prompts/explain.md" with { type: "text" };
import journalPrompt from "./prompts/journal.md" with { type: "text" };

const DAY = 86_400_000;

/** Facts for the last 24 hours, shared by the AI journal and the no-AI fallback. */
export function journalFacts(engine: Engine) {
  const now = engine.clock.now();
  const since = now - DAY;
  const bots = engine.listBots().map((bot) => {
    const closed = engine.store
      .listTrades({ botId: bot.id, since })
      .filter((t) => t.status === "closed" && (t.closedAt ?? 0) >= since);
    const errors = engine.store
      .listDecisions(bot.id, { since, kinds: ["error"], limit: 3 })
      .map((d) => d.message);
    return {
      name: bot.name,
      strategy: getStrategy(bot.strategyId).name,
      status: bot.status,
      symbols: bot.symbols,
      trades: closed.length,
      pnlUsd: round(closed.reduce((s, t) => s + (t.pnlUsd ?? 0), 0)),
      openPositions: engine.store.listTrades({ botId: bot.id, status: "open" }).length,
      decisions: engine.store
        .decisionCounts(bot.id, since)
        .map((c) => ({ ...c, meaning: reasonText(c.code) })),
      recentErrors: errors,
    };
  });
  const problems = engine.store
    .listEvents({ since, limit: 30 })
    .filter((e) => e.level !== "info")
    .map((e) => e.message);
  const accounts = engine.listAccounts().map((a) => {
    const series = engine.store.equitySeries(a.id, since, now);
    const first = series[0]?.equity;
    const last = series.at(-1)?.equity;
    return {
      name: a.name,
      equity: last ?? null,
      change: first && last ? round(last - first) : null,
    };
  });
  return {
    date: localDateKey(now),
    accounts,
    bots,
    problems,
    aiSpentTodayUsd: round(engine.ai.spentToday(), 4),
  };
}

function plainJournal(facts: ReturnType<typeof journalFacts>): string {
  const trades = facts.bots.reduce((s, b) => s + b.trades, 0);
  const pnl = facts.bots.reduce((s, b) => s + b.pnlUsd, 0);
  const lines = [`Last 24 hours: ${trades} trade(s), ${usd(pnl)} realized.`];
  for (const b of facts.bots) {
    const top = b.decisions[0];
    const checks = b.decisions.reduce((s, d) => s + d.count, 0);
    lines.push(
      `${b.name}: ${b.trades} trade(s), ${usd(b.pnlUsd)}; ${checks} checks${top ? `, mostly "${top.meaning}"` : ""}.`,
    );
  }
  lines.push(
    facts.problems.length
      ? `Needs attention: ${facts.problems.slice(0, 5).join(" | ")}`
      : "No problems.",
  );
  lines.push("(Add an AI key in Settings for a written briefing with suggestions.)");
  return lines.join("\n");
}

export async function writeJournal(engine: Engine): Promise<Journal> {
  const facts = journalFacts(engine);
  let text: string;
  if (engine.ai.configured()) {
    try {
      const { message } = await engine.ai.complete({
        purpose: "journal",
        messages: [
          { role: "system", content: journalPrompt },
          { role: "user", content: JSON.stringify(facts) },
        ],
        maxTokens: 700,
        promptVersion: promptVersion(journalPrompt),
      });
      text = message.content?.trim() || plainJournal(facts);
    } catch (err) {
      text = `${plainJournal(facts)}\n(AI briefing failed: ${errorMessage(err)})`;
    }
  } else {
    text = plainJournal(facts);
  }
  const ts = engine.clock.now();
  engine.events.event("info", "journal", `Journal for ${facts.date}`, { date: facts.date, text });
  return { ts, date: facts.date, text };
}

export function latestJournal(engine: Engine): Journal | null {
  const e = engine.store.listEvents({ kind: "journal", limit: 1 })[0];
  return e
    ? { ts: e.ts, date: String(e.data?.date ?? ""), text: String(e.data?.text ?? "") }
    : null;
}

export async function explain(
  engine: Engine,
  ref: { decisionId?: string; tradeId?: string },
): Promise<string> {
  const decisions = [];
  if (ref.decisionId) {
    const d = engine.store.getDecision(ref.decisionId);
    if (!d) throw new InputError("Unknown decision");
    decisions.push(d);
  } else {
    const t = engine.store.getTrade(ref.tradeId ?? "");
    if (!t) throw new InputError("Unknown trade");
    for (const orderId of [t.entryOrderId, t.exitOrderId]) {
      const decisionId = orderId ? engine.store.getOrder(orderId)?.decisionId : null;
      const d = decisionId ? engine.store.getDecision(decisionId) : null;
      if (d) decisions.push(d);
    }
    if (!decisions.length) throw new InputError("This trade has no recorded decisions to explain");
  }
  const first = decisions[0] as (typeof decisions)[number];
  const bot = engine.getBot(first.botId);
  const bars = engine.bars
    .closedBars(first.symbol, bot.timeframe, first.barTs, 30)
    .map((b) => ({ t: new Date(b.ts).toISOString(), c: round(b.c, 4) }));
  const facts = {
    bot: {
      name: bot.name,
      strategy: getStrategy(bot.strategyId).name,
      description: getStrategy(bot.strategyId).description,
      params: bot.params,
      risk: bot.risk,
    },
    decisions: decisions.map((d) => ({
      at: new Date(d.barTs).toISOString(),
      symbol: d.symbol,
      kind: d.kind,
      reason: reasonText(d.code),
      message: d.message,
      numbers: d.values,
    })),
    recentCloses: bars,
  };
  if (!engine.ai.configured()) {
    return decisions.map((d) => `${d.kind.toUpperCase()} ${d.symbol}: ${d.message}`).join("\n");
  }
  const contextHash = sha256(JSON.stringify(facts));
  const version = promptVersion(explainPrompt);
  const cached = engine.store.cachedAiCall("explain", engine.ai.model(), version, contextHash);
  if (cached?.response) return cached.response;
  const { message } = await engine.ai.complete({
    purpose: "explain",
    botId: bot.id,
    messages: [
      { role: "system", content: explainPrompt },
      { role: "user", content: JSON.stringify(facts) },
    ],
    maxTokens: 400,
    promptVersion: version,
    contextHash,
  });
  return message.content?.trim() ?? "";
}

// ---------------- assistant ----------------

const tool = (
  name: string,
  description: string,
  properties: Record<string, unknown> = {},
  required: string[] = [],
): ToolDef => ({
  type: "function",
  function: {
    name,
    description,
    parameters: { type: "object", properties, required, additionalProperties: false },
  },
});

const TOOLS: ToolDef[] = [
  tool("get_status", "Engine health: accounts, data, AI budget, market hours, sleep gaps."),
  tool("list_bots", "All bots with strategy, symbols, status and today's numbers."),
  tool(
    "get_bot_summary",
    "Today's decision counts for one bot, the closest it came to trading, P&L.",
    { bot: { type: "string", description: "Bot name or id" } },
    ["bot"],
  ),
  tool(
    "get_decisions",
    "Recent decisions of one bot, newest first.",
    {
      bot: { type: "string" },
      kind: { type: "string", enum: ["buy", "sell", "hold", "skip", "error"] },
      limit: { type: "number" },
    },
    ["bot"],
  ),
  tool("get_trades", "Recent trades, optionally for one bot.", {
    bot: { type: "string" },
    limit: { type: "number" },
  }),
  tool("list_strategies", "Available strategies with their settings."),
  tool(
    "run_backtest",
    "Run a backtest (costs nothing for rules strategies). Returns the metrics.",
    {
      strategyId: { type: "string" },
      symbols: { type: "array", items: { type: "string" } },
      timeframe: { type: "string", enum: ["5m", "15m", "1h"] },
      days: { type: "number" },
      params: { type: "object" },
    },
    ["strategyId", "symbols", "timeframe"],
  ),
  tool(
    "propose_action",
    "Show the user a button to make a change. You cannot make changes yourself.",
    {
      label: {
        type: "string",
        description: "Button text, e.g. 'Lower ETF Dip Buyer buy level to 15'",
      },
      action: {
        type: "string",
        enum: ["create_bot", "update_bot", "start_bot", "stop_bot", "run_backtest"],
      },
      payload: {
        type: "object",
        description:
          "For update_bot/start_bot/stop_bot include botId; for create_bot or run_backtest the full settings.",
      },
    },
    ["label", "action", "payload"],
  ),
];

function findBot(engine: Engine, ref: unknown) {
  const key = String(ref ?? "").toLowerCase();
  const bot =
    engine.listBots().find((b) => b.id === ref || b.name.toLowerCase() === key) ??
    engine.listBots().find((b) => b.name.toLowerCase().includes(key));
  if (!bot) throw new InputError(`No bot called "${String(ref)}"`);
  return bot;
}

async function runTool(
  engine: Engine,
  name: string,
  args: Record<string, unknown>,
  proposals: Proposal[],
): Promise<unknown> {
  switch (name) {
    case "get_status":
      return engine.status();
    case "list_bots":
      return engine
        .listBots()
        .map((b) => ({
          id: b.id,
          name: b.name,
          strategy: b.strategyId,
          symbols: b.symbols,
          timeframe: b.timeframe,
          status: b.status,
          params: b.params,
          today: engine.summary(b.id).counts,
        }));
    case "get_bot_summary":
      return engine.summary(findBot(engine, args.bot).id);
    case "get_decisions": {
      const bot = findBot(engine, args.bot);
      const kinds = args.kind ? [args.kind as "buy"] : undefined;
      return engine.store
        .listDecisions(bot.id, { kinds, limit: Math.min(Number(args.limit ?? 20), 50) })
        .map((d) => ({
          at: new Date(d.barTs).toISOString(),
          symbol: d.symbol,
          kind: d.kind,
          code: d.code,
          message: d.message,
        }));
    }
    case "get_trades": {
      const botId = args.bot ? findBot(engine, args.bot).id : undefined;
      return engine.store.listTrades({ botId, limit: Math.min(Number(args.limit ?? 20), 50) });
    }
    case "list_strategies":
      return STRATEGIES.map((s) => ({
        ...strategyInfo(s),
        params: undefined,
        settings: strategyInfo(s).defaults,
      }));
    case "run_backtest": {
      const input = backtestInputSchema.parse({
        ...args,
        risk: {
          stopLossPct: null,
          takeProfitPct: null,
          maxHoldBars: null,
          maxPositions: 10,
          dailyLossLimitUsd: 0,
        },
      });
      const bt = await engine.backtest(engine.backtestSpec(input));
      return bt.metrics;
    }
    case "propose_action": {
      proposals.push({
        label: String(args.label),
        action: args.action as Proposal["action"],
        payload: (args.payload ?? {}) as Record<string, unknown>,
      });
      return "The user now sees a button for this.";
    }
    default:
      return `Unknown tool ${name}`;
  }
}

export async function assistant(
  engine: Engine,
  history: AssistantMessage[],
): Promise<{ reply: string; proposals: Proposal[] }> {
  if (!engine.ai.configured())
    throw new InputError("The assistant needs an AI key. Add one in Settings.");
  const proposals: Proposal[] = [];
  const messages: ChatMessage[] = [{ role: "system", content: assistantPrompt }, ...history];
  for (let step = 0; step < 8; step++) {
    const { message } = await engine.ai.complete({
      purpose: "assistant",
      messages,
      tools: TOOLS,
      maxTokens: 900,
      promptVersion: promptVersion(assistantPrompt),
    });
    messages.push({
      role: "assistant",
      content: message.content ?? "",
      tool_calls: message.tool_calls,
    });
    if (!message.tool_calls?.length) return { reply: message.content ?? "", proposals };
    for (const call of message.tool_calls) {
      let result: unknown;
      try {
        result = await runTool(
          engine,
          call.function.name,
          JSON.parse(call.function.arguments || "{}"),
          proposals,
        );
      } catch (err) {
        result = { error: errorMessage(err) };
      }
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(result).slice(0, 12_000),
      });
    }
  }
  return { reply: "I ran out of steps. Try asking a narrower question.", proposals };
}
