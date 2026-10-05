// First run: connect Alpaca paper (or use the simulator), optionally add an AI key, start a test bot.
import type { BotRisk } from "@shared/types.ts";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, useAccounts, useSettings } from "../api.ts";
import logo from "../assets/exva-icon.png";
import { Button, ErrorText, Field, Input, Switch } from "../components/ui.tsx";
import { AddAlpaca } from "./Settings.tsx";

const risk = (maxPositions: number): BotRisk => ({
  stopLossPct: null,
  takeProfitPct: null,
  maxHoldBars: null,
  maxPositions,
  dailyLossLimitUsd: 200,
});

const STARTERS = [
  {
    key: "trend",
    name: "Crypto Trend",
    strategyId: "ema-cross",
    symbols: ["ETH/USD", "SOL/USD"],
    timeframe: "15m" as const,
    note: "EMA crossover on ETH and SOL, 15-minute bars. Trades day and night.",
  },
  {
    key: "dip",
    name: "ETF Dip Buyer",
    strategyId: "rsi-dip",
    symbols: ["SPY", "QQQ", "IWM", "DIA"],
    timeframe: "15m" as const,
    note: "Buys short dips in index ETFs during market hours. Needs an Alpaca account for stock data.",
  },
  {
    key: "ai",
    name: "AI Analyst",
    strategyId: "ai-analyst",
    symbols: ["AAPL", "MSFT", "NVDA", "AMZN", "META"],
    timeframe: "1h" as const,
    note: "DeepSeek decides once per hour on five megacaps. Needs the AI key.",
  },
];

export function Onboarding() {
  const client = useQueryClient();
  const { data: accounts = [] } = useAccounts();
  const { data: settings } = useSettings();
  const [step, setStep] = useState(0);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [aiKey, setAiKey] = useState("");
  const [picked, setPicked] = useState<Record<string, boolean>>({
    trend: true,
    dip: true,
    ai: false,
  });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const account = accountId ?? accounts[0]?.id ?? null;
  const isAlpaca = accounts.find((a) => a.id === account)?.broker === "alpaca";

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const useSimulator = () =>
    run(async () => {
      const a = await api.saveAccount({ name: "Simulator", broker: "sim", startingCash: 100_000 });
      setAccountId(a.id);
      await client.invalidateQueries();
      setStep(1);
    });

  const startHeartbeat = () =>
    run(async () => {
      if (!account) return;
      const { bot } = await api.createBot({
        name: "Heartbeat",
        strategyId: "heartbeat",
        params: { holdBars: 1 },
        symbols: ["BTC/USD"],
        timeframe: "5m",
        accountId: account,
        dollarsPerTrade: 25,
        risk: risk(1),
      });
      await api.startBot(bot.id);
      setStep(3);
    });

  const finish = () =>
    run(async () => {
      if (account) {
        for (const s of STARTERS.filter(
          (x) =>
            picked[x.key] &&
            (x.key !== "ai" || settings?.ai.hasKey) &&
            (x.key !== "dip" || isAlpaca),
        )) {
          const strategies = await api.strategies();
          const info = strategies.find((x) => x.id === s.strategyId);
          const { bot } = await api.createBot({
            name: s.name,
            strategyId: s.strategyId,
            params: info?.defaults ?? {},
            symbols: s.symbols,
            timeframe: s.timeframe,
            accountId: account,
            dollarsPerTrade: 1_000,
            risk: risk(s.symbols.length),
          });
          await api.startBot(bot.id);
        }
      }
      await api.saveSettings({ onboarded: true });
      await client.invalidateQueries();
    });

  return (
    <div className="flex min-h-full items-center justify-center p-6">
      <div className="w-full max-w-xl">
        <div className="mb-8 flex items-center gap-3">
          <img src={logo} alt="" className="h-10 w-10" />
          <div>
            <h1 className="text-xl font-medium">Welcome to Exva</h1>
            <p className="text-sm text-ink3">
              Bots that paper-trade around the clock, and tell you why they did or didn't trade.
            </p>
          </div>
        </div>
        <div className="rounded border border-line bg-surface p-6">
          <div className="mb-4 font-mono text-label uppercase text-ink3">Step {step + 1} of 4</div>
          {step === 0 && (
            <div className="space-y-4">
              <h2 className="text-lg font-medium">Connect your Alpaca paper account</h2>
              <p className="text-sm text-ink2">
                Paper trading only: no real money. Your keys stay on this computer.
              </p>
              <AddAlpaca
                onDone={(id) => {
                  setAccountId(id);
                  setStep(1);
                }}
              />
              <div className="border-t border-hair pt-4 text-sm text-ink3">
                No Alpaca account yet?{" "}
                <button
                  type="button"
                  className="text-ink underline"
                  onClick={useSimulator}
                  disabled={busy}
                >
                  Use the built-in simulator
                </button>{" "}
                (crypto data works without keys).
              </div>
            </div>
          )}
          {step === 1 && (
            <div className="space-y-4">
              <h2 className="text-lg font-medium">Connect DeepSeek (optional)</h2>
              <p className="text-sm text-ink2">
                Powers the AI Analyst bot, the morning journal and "Explain". DeepSeek V4.1 Flash
                costs well under a cent per decision.
              </p>
              <Field
                label="DeepSeek API key"
                hint="From platform.deepseek.com → API keys. You can add it later in Settings."
              >
                <Input
                  type="password"
                  value={aiKey}
                  onChange={(e) => setAiKey(e.target.value)}
                  placeholder="sk-…"
                  autoComplete="off"
                />
              </Field>
              <div className="flex justify-between">
                <Button variant="ghost" onClick={() => setStep(2)}>
                  Skip
                </Button>
                <Button
                  variant="primary"
                  disabled={!aiKey || busy}
                  onClick={() =>
                    run(async () => {
                      await api.saveSettings({ aiApiKey: aiKey.trim() });
                      await client.invalidateQueries({ queryKey: ["settings"] });
                      setStep(2);
                    })
                  }
                >
                  Save key
                </Button>
              </div>
            </div>
          )}
          {step === 2 && (
            <div className="space-y-4">
              <h2 className="text-lg font-medium">Prove it works: start a test bot</h2>
              <p className="text-sm text-ink2">
                The Heartbeat bot buys $25 of BTC/USD, sells it on the next 5-minute bar, and
                repeats. Your first trade should appear within about 10 minutes
                {isAlpaca ? ", here and on app.alpaca.markets" : ""}.
              </p>
              <div className="flex justify-between">
                <Button variant="ghost" onClick={() => setStep(3)}>
                  Skip
                </Button>
                <Button variant="primary" onClick={startHeartbeat} disabled={busy || !account}>
                  Start Heartbeat bot
                </Button>
              </div>
            </div>
          )}
          {step === 3 && (
            <div className="space-y-4">
              <h2 className="text-lg font-medium">Pick starter bots</h2>
              <p className="text-sm text-ink2">
                You can change or stop any of them later. Each trades $1,000 per position.
              </p>
              <div className="space-y-3">
                {STARTERS.map((s) => {
                  const unavailable =
                    (s.key === "ai" && !settings?.ai.hasKey) || (s.key === "dip" && !isAlpaca);
                  return (
                    <div key={s.key} className={unavailable ? "opacity-40" : ""}>
                      <Switch
                        checked={!unavailable && Boolean(picked[s.key])}
                        onChange={(v) => !unavailable && setPicked({ ...picked, [s.key]: v })}
                        label={<span className="font-medium">{s.name}</span>}
                      />
                      <p className="ml-12 text-xs text-ink3">{s.note}</p>
                    </div>
                  );
                })}
              </div>
              <div className="flex justify-end">
                <Button variant="primary" onClick={finish} disabled={busy}>
                  Start and open Exva
                </Button>
              </div>
            </div>
          )}
          <div className="mt-4">
            <ErrorText error={error} />
          </div>
        </div>
      </div>
    </div>
  );
}
