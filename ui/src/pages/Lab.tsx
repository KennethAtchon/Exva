// Backtests: same engine as live trading, replayed over history with the Simulator.
import { reasonText } from "@shared/reasons.ts";
import type { Backtest, BotRisk, StrategyInfo, Timeframe } from "@shared/types.ts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { PageTitle } from "../App.tsx";
import {
  api,
  type BacktestListItem,
  type BacktestRequest,
  useBots,
  useStrategies,
} from "../api.ts";
import { TradesTable } from "../components/bits.tsx";
import { CandleChart, EquityChart } from "../components/charts.tsx";
import { ParamForm } from "../components/ParamForm.tsx";
import {
  Button,
  Card,
  cx,
  Empty,
  ErrorText,
  Field,
  KindBadge,
  Modal,
  Notice,
  NumberInput,
  Select,
  Stat,
} from "../components/ui.tsx";
import { dateTime, num, pct, pnlColor, usd } from "../format.ts";
import { RiskFields, SymbolPicker } from "./BotWizard.tsx";

const DAYS = [7, 30, 90, 365];
const BARS_PER_DAY: Record<Timeframe, number> = { "5m": 288, "15m": 96, "1h": 24 };
const NO_RISK: BotRisk = {
  stopLossPct: null,
  takeProfitPct: null,
  maxHoldBars: null,
  maxPositions: 10,
  dailyLossLimitUsd: 0,
};

function defaults(s: StrategyInfo): BacktestRequest {
  return {
    strategyId: s.id,
    params: { ...s.defaults },
    symbols: s.defaultSymbols,
    timeframe: s.defaultTimeframe,
    days: 30,
    startingCash: 100_000,
    dollarsPerTrade: 1_000,
    slippageBps: 2,
    feeBps: 0,
    risk: { ...NO_RISK, maxPositions: Math.max(1, s.defaultSymbols.length) },
    aiMaxCalls: 0,
  };
}

export function Lab() {
  const { data: strategies = [] } = useStrategies();
  const { data: bots = [] } = useBots();
  const search = new URLSearchParams(useSearch());
  const [, navigate] = useLocation();
  const client = useQueryClient();
  const [form, setForm] = useState<BacktestRequest | null>(null);
  const [runId, setRunId] = useState<string | null>(search.get("run"));
  const [compare, setCompare] = useState<string[]>([]);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (form || !strategies.length) return;
    const botId = search.get("bot");
    const bot = bots.find((b) => b.id === botId);
    if (botId && !bot) return; // wait for bots to load
    const s = strategies.find((x) => x.id === (bot?.strategyId ?? "ema-cross")) ?? strategies[0];
    if (!s) return;
    setForm(
      bot
        ? {
            ...defaults(s),
            params: bot.params,
            symbols: bot.symbols,
            timeframe: bot.timeframe,
            dollarsPerTrade: bot.dollarsPerTrade,
            risk: bot.risk,
          }
        : defaults(s),
    );
  }, [strategies, bots, form, search]);

  const { data: runs = [] } = useQuery({ queryKey: ["backtests"], queryFn: api.backtests });
  const strategy = strategies.find((s) => s.id === form?.strategyId);
  const set = (patch: Partial<BacktestRequest>) => setForm((f) => (f ? { ...f, ...patch } : f));
  const estCalls = form
    ? form.symbols.length *
      form.days *
      BARS_PER_DAY[form.timeframe] *
      (form.symbols.every((s) => !s.includes("/")) ? 0.27 : 1)
    : 0;

  const run = async () => {
    if (!form) return;
    setError(null);
    try {
      const { id } = await api.startBacktest(form);
      setRunId(id);
      navigate(`/lab?run=${id}`, { replace: true });
      client.invalidateQueries({ queryKey: ["backtests"] });
    } catch (err) {
      setError(err);
    }
  };

  return (
    <div>
      <PageTitle
        title="Lab"
        sub="Replay a strategy over history with the exact code your bots run live."
      />
      <div className="grid gap-5 lg:grid-cols-[360px_1fr]">
        <div className="space-y-5">
          {form && strategy && (
            <Card title="Backtest">
              <div className="space-y-4">
                <Field label="Strategy">
                  <Select
                    value={form.strategyId}
                    onChange={(id) =>
                      setForm(defaults(strategies.find((s) => s.id === id) as StrategyInfo))
                    }
                    options={strategies.map((s) => ({ value: s.id, label: s.name }))}
                  />
                </Field>
                <Field label="Symbols">
                  <SymbolPicker value={form.symbols} onChange={(symbols) => set({ symbols })} />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Timeframe">
                    <Select
                      value={form.timeframe}
                      onChange={(timeframe) => set({ timeframe })}
                      options={strategy.timeframes.map((t) => ({ value: t, label: t }))}
                    />
                  </Field>
                  <Field label="Period">
                    <Select
                      value={String(form.days)}
                      onChange={(d) => set({ days: Number(d) })}
                      options={DAYS.map((d) => ({ value: String(d), label: `Last ${d} days` }))}
                    />
                  </Field>
                  <Field label="Starting cash">
                    <NumberInput
                      value={form.startingCash ?? 100_000}
                      onChange={(v) => set({ startingCash: v ?? 100_000 })}
                    />
                  </Field>
                  <Field label="$ per trade">
                    <NumberInput
                      value={form.dollarsPerTrade ?? 1000}
                      onChange={(v) => set({ dollarsPerTrade: v ?? 1000 })}
                    />
                  </Field>
                  <Field label="Slippage (bps)">
                    <NumberInput
                      value={form.slippageBps ?? 2}
                      onChange={(v) => set({ slippageBps: v ?? 0 })}
                    />
                  </Field>
                  <Field label="Fee (bps)">
                    <NumberInput
                      value={form.feeBps ?? 0}
                      onChange={(v) => set({ feeBps: v ?? 0 })}
                    />
                  </Field>
                </div>
                <ParamForm
                  schema={strategy.params}
                  value={form.params}
                  onChange={(params) => set({ params })}
                />
                <details>
                  <summary className="cursor-pointer text-sm text-ink2">Exits and limits</summary>
                  <div className="pt-3">
                    <RiskFields risk={form.risk} onChange={(risk) => set({ risk })} />
                  </div>
                </details>
                {strategy.usesAi && (
                  <Field
                    label="AI call cap"
                    hint={`Each checked bar is one paid AI call (about ${Math.round(estCalls).toLocaleString()} for this setup). Answers are cached, so re-running is free. Results before the model's training cutoff can look too good.`}
                  >
                    <NumberInput
                      value={form.aiMaxCalls ?? 0}
                      min={0}
                      max={5000}
                      onChange={(v) => set({ aiMaxCalls: v ?? 0 })}
                    />
                  </Field>
                )}
                <ErrorText error={error} />
                <Button
                  variant="primary"
                  className="w-full"
                  onClick={run}
                  disabled={!form.symbols.length}
                >
                  Run backtest
                </Button>
              </div>
            </Card>
          )}
          <RunList
            runs={runs}
            strategies={strategies}
            selected={runId}
            onSelect={setRunId}
            compare={compare}
            setCompare={setCompare}
          />
        </div>
        <div className="min-w-0">
          {runId ? (
            <Result id={runId} />
          ) : (
            <Empty>Run a backtest, or pick one from the history.</Empty>
          )}
        </div>
      </div>
      <CompareModal
        ids={compare.length === 2 ? compare : []}
        onClose={() => setCompare([])}
        strategies={strategies}
      />
    </div>
  );
}

function RunList({
  runs,
  strategies,
  selected,
  onSelect,
  compare,
  setCompare,
}: {
  runs: BacktestListItem[];
  strategies: StrategyInfo[];
  selected: string | null;
  onSelect: (id: string) => void;
  compare: string[];
  setCompare: (ids: string[]) => void;
}) {
  const [picking, setPicking] = useState<string[]>([]);
  if (!runs.length) return null;
  return (
    <Card
      title="History"
      actions={
        picking.length === 2 ? (
          <Button size="sm" variant="primary" onClick={() => setCompare(picking)}>
            Compare
          </Button>
        ) : (
          <span className="text-xs text-ink3">tick 2 to compare</span>
        )
      }
    >
      <ul className="-mx-2 max-h-80 space-y-0.5 overflow-y-auto">
        {runs.map((r) => (
          <li
            key={r.id}
            className={cx(
              "flex items-center gap-2 rounded px-2 py-1.5 text-sm",
              selected === r.id ? "bg-surface3" : "hover:bg-surface2",
            )}
          >
            <input
              type="checkbox"
              checked={picking.includes(r.id) || compare.includes(r.id)}
              onChange={(e) =>
                setPicking(
                  e.target.checked
                    ? [...picking, r.id].slice(-2)
                    : picking.filter((x) => x !== r.id),
                )
              }
              aria-label="Select for comparison"
            />
            <button
              type="button"
              onClick={() => onSelect(r.id)}
              className="min-w-0 flex-1 text-left"
            >
              <div className="truncate">
                {strategies.find((s) => s.id === r.spec.strategyId)?.name ?? r.spec.strategyId} ·{" "}
                {r.spec.symbols.join(" ")} · {r.spec.timeframe}
              </div>
              <div className="font-mono text-xs text-ink3">
                {dateTime(r.createdAt)} ·{" "}
                {r.status === "done" && r.metrics ? (
                  <span className={pnlColor(r.metrics.netPnl)}>
                    {usd(r.metrics.netPnl, true)} · {r.metrics.trades} trades
                  </span>
                ) : (
                  r.status
                )}
              </div>
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Result({ id }: { id: string }) {
  const { data: bt, error } = useQuery({
    queryKey: ["backtest", id],
    queryFn: () => api.backtest(id),
    refetchInterval: (q) => (q.state.data?.status === "running" ? 1000 : false),
  });
  const [symbol, setSymbol] = useState<string | null>(null);
  const [applyOpen, setApplyOpen] = useState(false);
  const [, navigate] = useLocation();
  if (error) return <ErrorText error={error} />;
  if (!bt) return null;
  if (bt.status === "running")
    return <Card title="Running">Replaying history… this usually takes a few seconds.</Card>;
  if (bt.status === "error") return <ErrorText error={bt.error} />;
  const m = bt.metrics;
  if (!m) return null;
  const active = symbol ?? bt.spec.symbols[0] ?? "";
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap justify-end gap-2">
        <Button onClick={() => setApplyOpen(true)}>Update a bot with these settings</Button>
        <Button variant="primary" onClick={() => navigate(`/bots/new?from=${bt.id}`)}>
          Create bot from this run
        </Button>
      </div>
      {m.trades < 30 && (
        <Notice>Only {m.trades} closed trades. Too few to judge the strategy.</Notice>
      )}
      <div className="grid grid-cols-2 gap-4 rounded border border-line bg-surface p-4 md:grid-cols-4">
        <Stat
          label="Net P&L"
          value={usd(m.netPnl, true)}
          tone={pnlColor(m.netPnl)}
          sub={pct(m.netPnlPct)}
        />
        <Stat label="Trades" value={m.trades} sub={`${m.tradesPerDay} per day`} />
        <Stat
          label="Win rate"
          value={m.winRate === null ? "–" : `${m.winRate}%`}
          sub={`avg ${usd(m.avgWin)} / ${usd(m.avgLoss)}`}
        />
        <Stat label="Max drawdown" value={usd(-m.maxDrawdown)} sub={`${m.maxDrawdownPct}%`} />
        <Stat label="Profit factor" value={m.profitFactor ?? "–"} />
        <Stat label="Sharpe" value={m.sharpe ?? "–"} sub="annualized" />
        <Stat label="Buy & hold" value={pct(m.buyHoldPct)} sub="same symbols" />
        <Stat
          label="Time in market"
          value={`${m.exposurePct}%`}
          sub={
            m.aiCalls ? `${m.aiCalls} AI calls, ${usd(m.aiCostUsd)}` : `${m.openAtEnd} open at end`
          }
        />
      </div>
      <Card title="Equity and drawdown">
        <EquityChart points={bt.equity} height={260} drawdown />
      </Card>
      <Card
        title="Trades on the chart"
        actions={bt.spec.symbols.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSymbol(s)}
            className={cx(
              "font-mono text-label",
              s === active ? "text-ink" : "text-ink3 hover:text-ink",
            )}
          >
            {s}
          </button>
        ))}
      >
        <RunChart bt={bt} symbol={active} />
      </Card>
      <Card title="What the strategy did">
        <div className="space-y-1.5 text-sm">
          {bt.decisionCounts.slice(0, 8).map((c) => (
            <div key={`${c.kind}${c.code}`} className="flex items-center gap-3">
              <span className="w-14 text-right font-mono text-xs text-ink3">
                {c.count.toLocaleString()}×
              </span>
              <KindBadge kind={c.kind} />
              <span className="text-ink2">{reasonText(c.code)}</span>
            </div>
          ))}
        </div>
      </Card>
      <Card title={`Trades (${bt.trades.length})`}>
        <TradesTable trades={[...bt.trades].reverse()} showBot={false} />
      </Card>
      <ApplyModal open={applyOpen} onClose={() => setApplyOpen(false)} bt={bt} />
    </div>
  );
}

function RunChart({ bt, symbol }: { bt: Backtest; symbol: string }) {
  const { data } = useQuery({
    queryKey: ["chart", symbol, bt.spec.timeframe, bt.spec.from, bt.spec.to],
    queryFn: () =>
      api.chart({ symbol, timeframe: bt.spec.timeframe, from: bt.spec.from, to: bt.spec.to }),
  });
  if (!data) return <div className="h-[320px]" />;
  const markers = bt.fills.filter((f) => f.symbol === symbol);
  return <CandleChart data={{ bars: data.bars, markers }} timeframe={bt.spec.timeframe} />;
}

function ApplyModal({ open, onClose, bt }: { open: boolean; onClose: () => void; bt: Backtest }) {
  const { data: bots = [] } = useBots();
  const matching = bots.filter((b) => b.strategyId === bt.spec.strategyId);
  const [botId, setBotId] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [, navigate] = useLocation();
  const apply = async () => {
    try {
      const id = botId || matching[0]?.id || "";
      await api.updateBot(id, {
        params: bt.spec.params,
        symbols: bt.spec.symbols,
        timeframe: bt.spec.timeframe,
        dollarsPerTrade: bt.spec.dollarsPerTrade,
        risk: bt.spec.risk,
        backtestId: bt.id,
      });
      navigate(`/bots/${id}`);
    } catch (err) {
      setError(err);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title="Update a bot">
      {matching.length === 0 ? (
        <p className="text-sm text-ink2">
          No bot uses this strategy yet. Create one from this run instead.
        </p>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-ink2">
            The bot gets exactly this run's symbols, timeframe, settings and risk limits.
          </p>
          <Select
            value={botId || matching[0]?.id || ""}
            onChange={setBotId}
            options={matching.map((b) => ({ value: b.id, label: b.name }))}
          />
          <ErrorText error={error} />
          <div className="flex justify-end">
            <Button variant="primary" onClick={apply}>
              Update bot
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function CompareModal({
  ids,
  onClose,
  strategies,
}: {
  ids: string[];
  onClose: () => void;
  strategies: StrategyInfo[];
}) {
  const a = useQuery({
    queryKey: ["backtest", ids[0]],
    queryFn: () => api.backtest(ids[0] as string),
    enabled: ids.length === 2,
  });
  const b = useQuery({
    queryKey: ["backtest", ids[1]],
    queryFn: () => api.backtest(ids[1] as string),
    enabled: ids.length === 2,
  });
  const runs = [a.data, b.data].filter(Boolean) as Backtest[];
  const rows: [string, (r: Backtest) => string][] = [
    [
      "Strategy",
      (r) => strategies.find((s) => s.id === r.spec.strategyId)?.name ?? r.spec.strategyId,
    ],
    ["Symbols", (r) => `${r.spec.symbols.join(" ")} · ${r.spec.timeframe}`],
    [
      "Settings",
      (r) =>
        Object.entries(r.spec.params)
          .map(([k, v]) => `${k}=${String(v).slice(0, 20)}`)
          .join(", "),
    ],
    ["Net P&L", (r) => usd(r.metrics?.netPnl, true)],
    ["Trades / day", (r) => `${r.metrics?.trades} / ${r.metrics?.tradesPerDay}`],
    ["Win rate", (r) => (r.metrics?.winRate === null ? "–" : `${r.metrics?.winRate}%`)],
    ["Profit factor", (r) => String(r.metrics?.profitFactor ?? "–")],
    ["Max drawdown", (r) => `${usd(r.metrics?.maxDrawdown)} (${r.metrics?.maxDrawdownPct}%)`],
    ["Sharpe", (r) => String(r.metrics?.sharpe ?? "–")],
    ["Days", (r) => num(r.metrics?.days, 1)],
  ];
  return (
    <Modal open={ids.length === 2} onClose={onClose} title="Compare runs" wide>
      {runs.length === 2 && (
        <table className="w-full text-sm">
          <tbody className="divide-y divide-hair">
            {rows.map(([label, f]) => (
              <tr key={label}>
                <td className="py-1.5 pr-4 text-ink3">{label}</td>
                {runs.map((r) => (
                  <td key={r.id} className="py-1.5 pr-4 font-mono text-xs">
                    {f(r)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Modal>
  );
}
