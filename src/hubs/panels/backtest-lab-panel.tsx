import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/exva";
import { formatIpcError } from "@/lib/ipc-error";
import { useExvaEvent } from "@/hooks/useExvaEvent";
import { HubPane } from "@/hubs/dna";
import { Button, Input } from "@/components/ui";
import { Badge } from "@/components/custom-ui";
import { fmt } from "@/lib/formatters";

type Strategy = { id: string; status: string };
type RunRow = {
  id: string;
  experienceId: string;
  contractHash: string;
  verdict: string;
  metricsJson: string;
  createdAt: string;
  windowStart: string;
  windowEnd: string;
};

/**
 * Backtest Lab — run / compare / threshold sweep (finish-line 08 T2).
 */
export function BacktestLabPanel() {
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [strategyId, setStrategyId] = useState("mean-reversion");
  const [experienceId, setExperienceId] = useState("rules-mean-reversion");
  const [symbols, setSymbols] = useState("SPY");
  const [timeframe, setTimeframe] = useState("1h");
  const [windowStart, setWindowStart] = useState("2024-01-01T00:00:00.000Z");
  const [windowEnd, setWindowEnd] = useState("2024-06-01T00:00:00.000Z");
  const [folds, setFolds] = useState(3);
  const [paramKey, setParamKey] = useState("zScoreEntry");
  const [sweepValues, setSweepValues] = useState("-2.5,-2,-1.5");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<Record<string, unknown> | null>(
    null,
  );
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [compareView, setCompareView] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => {
    void Promise.all([
      api.backtestListStrategies(),
      api.backtestList({ limit: 40 }),
    ])
      .then(([strategiesRes, runsRes]) => {
        setStrategies(strategiesRes.strategies as Strategy[]);
        setRuns(runsRes.runs as RunRow[]);
        setError(null);
      })
      .catch((err) => {
        setError(formatIpcError(err).display);
      });
  };

  useEffect(() => {
    refresh();
  }, []);

  useExvaEvent("backtest_progress", (p) => {
    setProgress(`${p.phase} ${p.pct}% — ${p.message}`);
  });

  const baseInput = useMemo(
    () => ({
      experienceId,
      strategyId,
      symbols: symbols
        .split(/[,\s]+/)
        .map((s) => s.trim())
        .filter(Boolean),
      timeframe,
      windowStart,
      windowEnd,
      folds,
    }),
    [
      experienceId,
      strategyId,
      symbols,
      timeframe,
      windowStart,
      windowEnd,
      folds,
    ],
  );

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = (await api.backtestRun(baseInput)) as {
        result: Record<string, unknown>;
        determinismHash: string;
      };
      setLastResult({
        ...result.result,
        determinismHash: result.determinismHash,
      });
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const sweep = async () => {
    setBusy(true);
    setError(null);
    try {
      const values = sweepValues
        .split(",")
        .map((v) => Number(v.trim()))
        .filter((n) => Number.isFinite(n));
      const result = await api.backtestSweep({
        ...baseInput,
        paramKey,
        values,
      });
      setLastResult(result as Record<string, unknown>);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const compare = async () => {
    if (compareIds.length < 2) return;
    setBusy(true);
    try {
      setCompareView(await api.backtestCompare(compareIds));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const toggleCompare = (id: string) => {
    setCompareIds((prev) =>
      prev.includes(id)
        ? prev.filter((x) => x !== id)
        : [...prev, id].slice(-4),
    );
  };

  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(280px,0.9fr)_minmax(0,1.1fr)]">
      <HubPane eyebrow="Spec" title="Run backtest">
        <div className="flex flex-col gap-3 p-4">
          <Field label="Experience id">
            <Input
              value={experienceId}
              onChange={(e) => setExperienceId(e.target.value)}
            />
          </Field>
          <Field label="Strategy">
            <select
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={strategyId}
              onChange={(e) => setStrategyId(e.target.value)}
            >
              {strategies.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.id} ({s.status})
                </option>
              ))}
            </select>
          </Field>
          <Field label="Symbols">
            <Input
              value={symbols}
              onChange={(e) => setSymbols(e.target.value)}
            />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Timeframe">
              <Input
                value={timeframe}
                onChange={(e) => setTimeframe(e.target.value)}
              />
            </Field>
            <Field label="Folds">
              <Input
                type="number"
                value={folds}
                onChange={(e) => setFolds(Number(e.target.value) || 1)}
              />
            </Field>
          </div>
          <Field label="Window start">
            <Input
              value={windowStart}
              onChange={(e) => setWindowStart(e.target.value)}
            />
          </Field>
          <Field label="Window end">
            <Input
              value={windowEnd}
              onChange={(e) => setWindowEnd(e.target.value)}
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy} onClick={() => void run()}>
              Run
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void sweep()}
            >
              Threshold sweep
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Sweep param">
              <Input
                value={paramKey}
                onChange={(e) => setParamKey(e.target.value)}
              />
            </Field>
            <Field label="Values">
              <Input
                value={sweepValues}
                onChange={(e) => setSweepValues(e.target.value)}
              />
            </Field>
          </div>
          {progress ? (
            <div className="font-mono text-[11px] text-[var(--text3)]">
              {progress}
            </div>
          ) : null}
          {error ? <div className="text-[12px] text-error">{error}</div> : null}
        </div>
      </HubPane>

      <div className="flex flex-col gap-3">
        <HubPane
          eyebrow="Results"
          title="Latest"
          actions={
            lastResult?.determinismHash ? (
              <Badge variant="success" size="sm">
                hash {(lastResult.determinismHash as string).slice(0, 8)}
              </Badge>
            ) : null
          }
        >
          <div className="p-4 font-mono text-[12px] text-[var(--text2)]">
            {lastResult ? (
              <pre className="m-0 whitespace-pre-wrap">
                {JSON.stringify(
                  {
                    tradeCount: lastResult.tradeCount,
                    expectancyBps: lastResult.expectancyBps,
                    sharpe: lastResult.sharpe,
                    maxDrawdownPct: lastResult.maxDrawdownPct,
                    costDragBps: lastResult.costDragBps,
                    folds: lastResult.folds,
                    experimentIds: lastResult.experimentIds,
                    trials: lastResult.trials,
                  },
                  null,
                  2,
                )}
              </pre>
            ) : (
              "Run a backtest to see fold metrics here."
            )}
          </div>
        </HubPane>

        <HubPane
          eyebrow="History"
          title="Saved runs"
          actions={
            <Button
              size="sm"
              variant="outline"
              disabled={compareIds.length < 2 || busy}
              onClick={() => void compare()}
            >
              Compare ({compareIds.length})
            </Button>
          }
        >
          <ul className="m-0 list-none divide-y divide-[var(--border)] p-0">
            {runs.map((run) => {
              let metrics: Record<string, unknown> = {};
              try {
                metrics = JSON.parse(run.metricsJson) as Record<
                  string,
                  unknown
                >;
              } catch {
                metrics = {};
              }
              const selected = compareIds.includes(run.id);
              return (
                <li
                  key={run.id}
                  className="flex cursor-pointer items-center justify-between gap-2 px-4 py-2.5"
                  onClick={() => toggleCompare(run.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") toggleCompare(run.id);
                  }}
                  role="button"
                  tabIndex={0}
                >
                  <div className="min-w-0">
                    <div className="truncate text-[13px] text-[var(--text1)]">
                      {run.experienceId} · {run.verdict}
                    </div>
                    <div className="font-mono text-[11px] text-[var(--text3)]">
                      {fmt.time(run.createdAt)} · trades{" "}
                      {String(metrics.tradeCount ?? "—")} · sharpe{" "}
                      {String(metrics.sharpe ?? "—")}
                    </div>
                  </div>
                  <Badge variant={selected ? "success" : "default"} size="sm">
                    {selected ? "selected" : run.contractHash.slice(0, 8)}
                  </Badge>
                </li>
              );
            })}
            {runs.length === 0 ? (
              <li className="px-4 py-6 text-[12px] text-[var(--text3)]">
                No backtest runs yet.
              </li>
            ) : null}
          </ul>
        </HubPane>

        {compareView ? (
          <HubPane eyebrow="Compare" title="Aligned metrics">
            <pre className="m-0 overflow-auto p-4 font-mono text-[11px] text-[var(--text2)]">
              {JSON.stringify(compareView, null, 2)}
            </pre>
          </HubPane>
        ) : null}
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--text3)]">
        {label}
      </span>
      {children}
    </div>
  );
}
