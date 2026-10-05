// Create or edit a bot in four steps, ending with a 30-day preview of how often it would trade.
import type { BotRisk, StrategyInfo, Timeframe } from "@shared/types.ts";
import { assetClassOf } from "@shared/types.ts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { PageTitle } from "../App.tsx";
import { api, type BotInput, useAccounts, useSettings, useStrategies } from "../api.ts";
import { EquityChart } from "../components/charts.tsx";
import { ParamForm } from "../components/ParamForm.tsx";
import {
  Button,
  Card,
  cx,
  ErrorText,
  Field,
  Input,
  Notice,
  NumberInput,
  Select,
  Stat,
} from "../components/ui.tsx";
import { pnlColor, usd } from "../format.ts";

export const SYMBOL_PRESETS: Record<string, string[]> = {
  "Top crypto": ["BTC/USD", "ETH/USD", "SOL/USD"],
  "Index ETFs": ["SPY", "QQQ", "IWM", "DIA"],
  "Sector ETFs": ["XLF", "XLK", "XLE", "XLV", "XLI", "XLY", "XLP", "XLU"],
  Megacaps: ["AAPL", "MSFT", "NVDA", "AMZN", "META", "GOOGL", "TSLA"],
};

const STEPS = ["Strategy", "What to trade", "Money & risk", "Preview"];

export interface Draft {
  name: string;
  strategyId: string;
  params: Record<string, unknown>;
  symbols: string[];
  timeframe: Timeframe;
  accountId: string;
  dollarsPerTrade: number;
  risk: BotRisk;
  backtestId: string | null;
}

export function SymbolPicker({
  value,
  onChange,
}: {
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const [text, setText] = useState("");
  const add = (raw: string) => {
    const next = raw
      .split(/[\s,]+/)
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    onChange([...new Set([...value, ...next])]);
    setText("");
  };
  return (
    <div>
      <div className="flex min-h-9 flex-wrap items-center gap-1.5 rounded border border-line bg-surface2 p-1.5">
        {value.map((s) => (
          <span
            key={s}
            className="flex items-center gap-1 rounded bg-surface3 px-2 py-0.5 font-mono text-xs"
          >
            {s}
            <button
              type="button"
              className="text-ink3 hover:text-down"
              onClick={() => onChange(value.filter((x) => x !== s))}
              aria-label={`Remove ${s}`}
            >
              ×
            </button>
          </span>
        ))}
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if ((e.key === "Enter" || e.key === ",") && text.trim()) {
              e.preventDefault();
              add(text);
            }
            if (e.key === "Backspace" && !text && value.length) onChange(value.slice(0, -1));
          }}
          onBlur={() => text.trim() && add(text)}
          placeholder={value.length ? "" : "SPY, BTC/USD…"}
          className="min-w-24 flex-1 bg-transparent px-1 font-mono text-sm outline-none placeholder:text-ink3"
        />
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {Object.entries(SYMBOL_PRESETS).map(([label, syms]) => (
          <button
            key={label}
            type="button"
            onClick={() => onChange([...new Set([...value, ...syms])])}
            className="rounded border border-line px-2 py-0.5 text-xs text-ink2 hover:text-ink"
          >
            + {label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function RiskFields({ risk, onChange }: { risk: BotRisk; onChange: (r: BotRisk) => void }) {
  const set = (k: keyof BotRisk, v: number | null) => onChange({ ...risk, [k]: v });
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <Field label="Stop-loss %" hint="Sell if price falls this far below entry. Empty = none.">
        <NumberInput
          value={risk.stopLossPct}
          min={0.1}
          step="any"
          onChange={(v) => set("stopLossPct", v)}
        />
      </Field>
      <Field label="Take-profit %" hint="Sell when price rises this far. Empty = none.">
        <NumberInput
          value={risk.takeProfitPct}
          min={0.1}
          step="any"
          onChange={(v) => set("takeProfitPct", v)}
        />
      </Field>
      <Field label="Max hold (bars)" hint="Sell after this many bars. Empty = none.">
        <NumberInput
          value={risk.maxHoldBars}
          min={1}
          step={1}
          onChange={(v) => set("maxHoldBars", v)}
        />
      </Field>
      <Field label="Max open positions">
        <NumberInput
          value={risk.maxPositions}
          min={1}
          step={1}
          onChange={(v) => set("maxPositions", v ?? 1)}
        />
      </Field>
      <Field
        label="Daily loss limit $"
        hint="No new buys after losing this much in a day. 0 = off."
      >
        <NumberInput
          value={risk.dailyLossLimitUsd}
          min={0}
          step={10}
          onChange={(v) => set("dailyLossLimitUsd", v ?? 0)}
        />
      </Field>
    </div>
  );
}

export function draftFrom(
  strategy: StrategyInfo,
  accountId: string,
  defaults: { dollarsPerTrade: number; dailyLossLimitUsd: number },
): Draft {
  return {
    name: strategy.name,
    strategyId: strategy.id,
    params: { ...strategy.defaults },
    symbols: strategy.defaultSymbols,
    timeframe: strategy.defaultTimeframe,
    accountId,
    dollarsPerTrade: defaults.dollarsPerTrade,
    risk: {
      stopLossPct: null,
      takeProfitPct: null,
      maxHoldBars: null,
      maxPositions: Math.max(1, strategy.defaultSymbols.length),
      dailyLossLimitUsd: defaults.dailyLossLimitUsd,
    },
    backtestId: null,
  };
}

export function BotWizard({ editId }: { editId?: string }) {
  const { data: strategies = [] } = useStrategies();
  const { data: accounts = [] } = useAccounts();
  const { data: settings } = useSettings();
  const search = new URLSearchParams(useSearch());
  const fromBacktest = search.get("from");
  const [, navigate] = useLocation();
  const client = useQueryClient();
  const [step, setStep] = useState(editId || fromBacktest ? 1 : 0);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);

  const existing = useQuery({
    queryKey: ["bot", editId],
    queryFn: () => api.bot(editId as string),
    enabled: Boolean(editId),
  });
  const backtest = useQuery({
    queryKey: ["backtest", fromBacktest],
    queryFn: () => api.backtest(fromBacktest as string),
    enabled: Boolean(fromBacktest),
  });

  useEffect(() => {
    if (draft) return;
    if (existing.data) {
      const { id: _id, status: _s, createdAt: _c, updatedAt: _u, ...rest } = existing.data.bot;
      setDraft(rest);
    } else if (backtest.data) {
      const sp = backtest.data.spec;
      const strategy = strategies.find((s) => s.id === sp.strategyId);
      setDraft({
        name: `${strategy?.name ?? sp.strategyId} (from Lab)`,
        strategyId: sp.strategyId,
        params: sp.params,
        symbols: sp.symbols,
        timeframe: sp.timeframe,
        accountId: accounts[0]?.id ?? "",
        dollarsPerTrade: sp.dollarsPerTrade,
        risk: sp.risk,
        backtestId: backtest.data.id,
      });
    }
  }, [existing.data, backtest.data, draft, strategies, accounts]);

  const strategy = strategies.find((s) => s.id === draft?.strategyId);
  const set = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const pick = (s: StrategyInfo) => {
    setDraft(
      draftFrom(
        s,
        accounts[0]?.id ?? "",
        settings?.defaults ?? { dollarsPerTrade: 1000, dailyLossLimitUsd: 200 },
      ),
    );
    setStep(1);
  };

  const save = async (start: boolean) => {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      const body: BotInput = { ...draft };
      const res = editId ? await api.updateBot(editId, body) : await api.createBot(body);
      if (start && res.bot.status !== "running") await api.startBot(res.bot.id);
      await client.invalidateQueries();
      setWarnings(res.warnings);
      navigate(`/bots/${res.bot.id}`);
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <PageTitle title={editId ? `Edit ${existing.data?.bot.name ?? "bot"}` : "New bot"} />
      <ol className="mb-5 flex gap-2">
        {STEPS.map((label, i) => (
          <li key={label} className="flex-1">
            <button
              type="button"
              disabled={!draft || i > step}
              onClick={() => setStep(i)}
              className={cx(
                "w-full border-t-2 pt-2 text-left text-xs",
                i <= step ? "border-ink text-ink" : "border-line text-ink3",
              )}
            >
              {i + 1}. {label}
            </button>
          </li>
        ))}
      </ol>

      {step === 0 && (
        <div className="grid gap-3 md:grid-cols-2">
          {strategies.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => pick(s)}
              className="rounded border border-line bg-surface p-4 text-left transition-colors hover:border-ink2"
            >
              <div className="flex items-center gap-2 font-medium">
                {s.name}
                {s.usesAi && (
                  <span className="rounded bg-ai/15 px-1.5 font-mono text-label text-ai">AI</span>
                )}
                {s.isTest && (
                  <span className="rounded bg-surface3 px-1.5 font-mono text-label text-ink2">
                    TEST
                  </span>
                )}
              </div>
              <p className="mt-1.5 text-sm text-ink2">{s.description}</p>
              <p className="mt-2 font-mono text-xs text-ink3">
                Default: {s.defaultSymbols.slice(0, 4).join(" ")}
                {s.defaultSymbols.length > 4 ? "…" : ""} · {s.defaultTimeframe}
              </p>
            </button>
          ))}
        </div>
      )}

      {draft && step === 1 && (
        <Card>
          <div className="space-y-5">
            <Field
              label="Symbols"
              hint="Crypto pairs (BTC/USD) trade around the clock. Stocks and ETFs trade 9:30–16:00 ET."
            >
              <SymbolPicker value={draft.symbols} onChange={(symbols) => set({ symbols })} />
            </Field>
            <Field
              label="Timeframe"
              hint="The bot checks once per closed bar. Shorter bars mean more checks and usually more trades."
            >
              <Select
                value={draft.timeframe}
                onChange={(timeframe) => set({ timeframe })}
                options={(strategy?.timeframes ?? ["5m", "15m", "1h"]).map((t) => ({
                  value: t,
                  label: { "5m": "5 minutes", "15m": "15 minutes", "1h": "1 hour" }[t],
                }))}
              />
            </Field>
          </div>
          <Nav
            onBack={editId || fromBacktest ? undefined : () => setStep(0)}
            onNext={() => setStep(2)}
            nextDisabled={!draft.symbols.length}
          />
        </Card>
      )}

      {draft && step === 2 && (
        <Card>
          <div className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Name">
                <Input value={draft.name} onChange={(e) => set({ name: e.target.value })} />
              </Field>
              <Field label="Account">
                <Select
                  value={draft.accountId}
                  onChange={(accountId) => set({ accountId })}
                  options={accounts.map((a) => ({
                    value: a.id,
                    label: `${a.name} (${a.broker === "sim" ? "simulator" : "Alpaca paper"})`,
                  }))}
                />
              </Field>
              <Field label="Dollars per trade">
                <NumberInput
                  value={draft.dollarsPerTrade}
                  min={10}
                  step={10}
                  onChange={(v) => set({ dollarsPerTrade: v ?? 10 })}
                />
              </Field>
            </div>
            <RiskFields risk={draft.risk} onChange={(risk) => set({ risk })} />
            {strategy && (
              <div>
                <h3 className="mb-3 font-mono text-label uppercase text-ink3">
                  {strategy.name} settings
                </h3>
                <ParamForm
                  schema={strategy.params}
                  value={draft.params}
                  onChange={(params) => set({ params })}
                />
              </div>
            )}
          </div>
          <Nav
            onBack={() => setStep(1)}
            onNext={() => setStep(3)}
            nextDisabled={!draft.accountId || !draft.name}
          />
        </Card>
      )}

      {draft && step === 3 && strategy && (
        <Card>
          <Preview draft={draft} strategy={strategy} />
          {warnings.map((w) => (
            <Notice key={w} tone="warn">
              {w}
            </Notice>
          ))}
          <div className="mt-4">
            <ErrorText error={error} />
          </div>
          <div className="mt-5 flex justify-between">
            <Button variant="ghost" onClick={() => setStep(2)}>
              Back
            </Button>
            <div className="flex gap-2">
              <Button onClick={() => save(false)} disabled={saving}>
                {editId ? "Save changes" : "Create (stopped)"}
              </Button>
              {!(editId && existing.data?.bot.status === "running") && (
                <Button variant="primary" onClick={() => save(true)} disabled={saving}>
                  {editId ? "Save & start" : "Create & start"}
                </Button>
              )}
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}

function Nav({
  onBack,
  onNext,
  nextDisabled,
}: {
  onBack?: () => void;
  onNext: () => void;
  nextDisabled?: boolean;
}) {
  return (
    <div className="mt-6 flex justify-between">
      {onBack ? (
        <Button variant="ghost" onClick={onBack}>
          Back
        </Button>
      ) : (
        <span />
      )}
      <Button variant="primary" onClick={onNext} disabled={nextDisabled}>
        Next
      </Button>
    </div>
  );
}

function Preview({ draft, strategy }: { draft: Draft; strategy: StrategyInfo }) {
  const req = useMemo(
    () => ({
      strategyId: draft.strategyId,
      params: draft.params,
      symbols: draft.symbols,
      timeframe: draft.timeframe,
      days: 30,
      dollarsPerTrade: draft.dollarsPerTrade,
      risk: draft.risk,
    }),
    [draft],
  );
  const { data, error, isFetching } = useQuery({
    queryKey: ["preview", req],
    queryFn: () => api.preview(req),
    enabled: !strategy.usesAi,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const stocks = draft.symbols.some((s) => assetClassOf(s) === "stock");
  if (strategy.usesAi) {
    return (
      <Notice>
        No free preview for AI strategies: every bar is a paid AI call. Run a capped backtest in the
        Lab to see how it behaves.
      </Notice>
    );
  }
  const m = data?.metrics;
  return (
    <div className="space-y-4">
      <h3 className="font-mono text-label uppercase text-ink3">Last 30 days with these settings</h3>
      {isFetching && <div className="text-sm text-ink3">Running a quick backtest…</div>}
      <ErrorText error={error} />
      {m && (
        <>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Stat label="Trades" value={m.trades} sub={`${m.tradesPerDay} per day`} />
            <Stat label="Net P&L" value={usd(m.netPnl, true)} tone={pnlColor(m.netPnl)} />
            <Stat label="Win rate" value={m.winRate === null ? "–" : `${m.winRate}%`} />
            <Stat label="Max drawdown" value={usd(-m.maxDrawdown)} sub={`${m.maxDrawdownPct}%`} />
          </div>
          {data && data.equity.length > 1 && <EquityChart points={data.equity} height={160} />}
          {m.trades === 0 && (
            <Notice tone="warn">
              0 trades in 30 days. This bot will probably sit idle. Loosen the settings, add
              symbols, or use a shorter timeframe.
            </Notice>
          )}
          {m.trades > 0 && m.trades < 30 && (
            <Notice>
              Only {m.trades} trades. That is too few to judge the strategy, but enough to see it
              work.
            </Notice>
          )}
        </>
      )}
      {stocks && (
        <Notice>
          Stock symbols only trade 9:30–16:00 ET on market days. Nights and weekends are
          crypto-only.
        </Notice>
      )}
    </div>
  );
}
