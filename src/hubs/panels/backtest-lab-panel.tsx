import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/exva";
import { formatIpcError } from "@/lib/ipc-error";
import { useExvaEvent } from "@/hooks/useExvaEvent";
import { HubPane } from "@/hubs/dna";
import { Button, Input } from "@/components/ui";
import { Badge } from "@/components/custom-ui";
import { EmptyState } from "@/components/ui/primitives";
import { PanelLoading } from "@/components/ui/skeleton";
import { fmt } from "@/lib/formatters";

type Strategy = { id: string; status: string; dataDriver: string };
type RunRow = {
  id: string;
  experienceId: string;
  contractHash: string;
  verdict: string;
  metricsJson: string;
  createdAt: string;
  windowStart: string;
  windowEnd: string;
  engineVersion?: number | null;
};
type Coverage = { firstTs: string; lastTs: string; provider: string } | null;

type EquityPoint = {
  ts: string;
  equityUsd: number;
  drawdownPct: number;
};

type TradeRow = {
  id: string;
  symbol: string;
  side: string;
  entryTs: string;
  exitTs: string | null;
  quantity: number;
  entryPrice: number;
  exitPrice: number | null;
  realizedPnlUsd: number;
  feesUsd: number;
  returnBps: number | null;
};

type RunDetail = {
  runId: string;
  spec: {
    strategy: { id: string; parameters: Record<string, unknown> };
    instruments: Array<{ symbol: string; timeframe: string }>;
    window: { start: string; end: string };
    folds: { count: number; purgeBars: number };
    costs: { spreadBps: number; commissionBps: number; slippageBps: number };
  } | null;
  equity: EquityPoint[];
  trades: TradeRow[];
  fills: Array<{
    ts: string;
    symbol: string;
    side: string;
    quantity: number;
    price: number;
    feeUsd: number;
  }>;
};

type PromotionBlock = {
  promote?: boolean;
  verdict?: string;
  failedCriteria?: string[];
  criteria?: Record<string, { pass: boolean; reason: string }>;
  dataQuality?: Array<{
    symbol: string;
    complete: boolean;
    provider: string | null;
    feed: string | null;
    blockers: string[];
  }>;
};

type FoldMetric = {
  fold: number;
  tradeCount: number;
  expectancyBps: number;
  maxDrawdownPct: number;
  winRate: number;
};

const CHART_W = 480;
const CHART_H = 160;
const PAD = { top: 12, right: 8, bottom: 22, left: 52 };

/**
 * Backtest Lab — run / compare / threshold sweep with persisted detail.
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
  const [backfillProgress, setBackfillProgress] = useState<string | null>(null);
  const [coverage, setCoverage] = useState<Coverage>(null);
  const [lastResult, setLastResult] = useState<Record<string, unknown> | null>(
    null,
  );
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [compareView, setCompareView] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
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
      })
      .finally(() => setLoading(false));
  }, []);

  const loadDetail = useCallback((runId: string) => {
    setDetailLoading(true);
    void api
      .backtestGetDetail(runId)
      .then((res) => {
        setDetail((res as { detail: RunDetail | null }).detail);
        setError(null);
      })
      .catch((err) => {
        setDetail(null);
        setError(formatIpcError(err).display);
      })
      .finally(() => setDetailLoading(false));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (selectedRunId) loadDetail(selectedRunId);
    else setDetail(null);
  }, [selectedRunId, loadDetail]);

  useExvaEvent("backtest_progress", (p) => {
    setProgress(`${p.phase} ${p.pct}% — ${p.message}`);
  });
  useExvaEvent("backfill_progress", (p) => {
    setBackfillProgress(
      `${p.done ? "Complete" : "Fetching"} ${p.chunkStart.slice(0, 10)} to ${p.chunkEnd.slice(0, 10)} · ${p.barsWritten} bars`,
    );
  });

  const selectedStrategy = strategies.find((s) => s.id === strategyId);
  const strategyBlocked = selectedStrategy && selectedStrategy.dataDriver !== "ohlcv";

  const selectedSymbol = symbols.split(/[\s,]+/).find(Boolean) ?? "";
  useEffect(() => {
    if (!selectedSymbol) return;
    void api
      .backtestCoverage(selectedSymbol, timeframe)
      .then((result) => setCoverage(result.coverage))
      .catch((err) => setError(formatIpcError(err).display));
  }, [selectedSymbol, timeframe]);

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
        run: RunRow;
        result: Record<string, unknown>;
        determinismHash: string;
      };
      setLastResult({
        ...result.result,
        determinismHash: result.determinismHash,
      });
      setSelectedRunId(result.run.id);
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

  const backfill = async () => {
    if (!selectedSymbol) return;
    setBusy(true);
    setError(null);
    setBackfillProgress("Starting historical pull…");
    try {
      await api.backtestBackfill({
        symbol: selectedSymbol,
        instrumentClass: selectedSymbol.includes("-") ? "crypto" : "stock",
        timeframe,
        startIso: windowStart,
        endIso: windowEnd,
      });
      const result = await api.backtestCoverage(selectedSymbol, timeframe);
      setCoverage(result.coverage);
    } catch (err) {
      setError(formatIpcError(err).display);
    } finally {
      setBusy(false);
    }
  };

  const requestedRangeExceedsCoverage =
    coverage && (windowStart < coverage.firstTs || windowEnd > coverage.lastTs);

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

  const selectedRun = runs.find((r) => r.id === selectedRunId) ?? null;
  const selectedMetrics = useMemo(() => {
    if (!selectedRun) return null;
    try {
      return JSON.parse(selectedRun.metricsJson) as Record<string, unknown> & {
        promotion?: PromotionBlock;
        folds?: FoldMetric[];
      };
    } catch {
      return null;
    }
  }, [selectedRun]);

  const promotion = selectedMetrics?.promotion;
  const foldMetrics = (selectedMetrics?.folds ?? []) as FoldMetric[];

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(280px,0.42fr)_minmax(0,0.58fr)]">
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
              className="h-8 w-full rounded-sm border border-hairline bg-surface2 px-3 font-sans text-body text-text1"
              value={strategyId}
              onChange={(e) => setStrategyId(e.target.value)}
            >
              {strategies.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.id} ({s.dataDriver})
                </option>
              ))}
            </select>
          </Field>
          {strategyBlocked ? (
            <div className="font-sans text-caption text-warning">
              {strategyId} requires {selectedStrategy?.dataDriver} data — not
              supported in Backtest Lab (OHLCV only).
            </div>
          ) : null}
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
          <div className="border-y border-hairline py-3">
            <div className="font-mono text-micro uppercase tracking-wider text-text3">
              Data coverage
            </div>
            <div className="mt-1 font-mono text-micro text-text2">
              {coverage
                ? `${coverage.firstTs.slice(0, 10)} to ${coverage.lastTs.slice(0, 10)} · ${coverage.provider} (Alpaca backfill when provider is alpaca)`
                : "No stored bars for selected symbol/timeframe."}
            </div>
            {requestedRangeExceedsCoverage ? (
              <div className="mt-1 font-sans text-caption text-warning">
                Requested run window exceeds stored coverage. Backfill it before
                running.
              </div>
            ) : null}
            {backfillProgress ? (
              <div className="mt-1 font-mono text-micro text-text3">
                {backfillProgress}
              </div>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => void backfill()}
            >
              Backfill range
            </Button>
            <Button disabled={busy || Boolean(strategyBlocked)} onClick={() => void run()}>
              Run
            </Button>
            <Button
              variant="secondary"
              disabled={busy || Boolean(strategyBlocked)}
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
            <div className="font-mono text-micro text-text3">{progress}</div>
          ) : null}
          {error ? (
            <div className="font-sans text-caption text-error">{error}</div>
          ) : null}
        </div>
      </HubPane>

      <div className="flex min-h-0 flex-col gap-4">
        <HubPane
          eyebrow="Detail"
          title={selectedRun ? `Run ${selectedRun.id.slice(0, 8)}` : "Select a run"}
          actions={
            selectedRun ? (
              <Badge
                variant={
                  selectedRun.verdict === "pass"
                    ? "success"
                    : selectedRun.verdict === "fail"
                      ? "danger"
                      : "default"
                }
                size="sm"
              >
                {selectedRun.verdict}
              </Badge>
            ) : null
          }
        >
          <div className="flex flex-col gap-4 p-4">
            {detailLoading ? <PanelLoading className="p-0" /> : null}
            {!detailLoading && !selectedRunId ? (
              <EmptyState message="Select a saved run to inspect equity, trades, and promotion criteria." />
            ) : null}
            {!detailLoading && selectedRunId && !detail ? (
              <EmptyState message="No V2 detail persisted for this run." />
            ) : null}
            {detail ? (
              <>
                <BacktestEquityChart points={detail.equity} />
                {detail.spec ? (
                  <AssumptionsPanel spec={detail.spec} />
                ) : null}
              </>
            ) : null}
            {promotion ? (
              <PromotionCriteriaPanel promotion={promotion} />
            ) : null}
            {foldMetrics.length > 0 ? (
              <FoldTable folds={foldMetrics} />
            ) : null}
            {detail && detail.trades.length > 0 ? (
              <TradeLedger trades={detail.trades} />
            ) : null}
          </div>
        </HubPane>

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
          <div className="p-4">
            {lastResult ? (
              <div className="grid gap-3">
                {"netPnlUsd" in lastResult || "endingEquityUsd" in lastResult ? (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <Metric
                      label="Net P&L $"
                      value={fmt.usd(Number(lastResult.netPnlUsd ?? 0))}
                    />
                    <Metric
                      label="Ending equity"
                      value={fmt.usd(Number(lastResult.endingEquityUsd ?? 0))}
                    />
                    <Metric
                      label="Max DD $"
                      value={fmt.usd(Number(lastResult.maxDrawdownUsd ?? 0))}
                    />
                    <Metric
                      label="Equity pts"
                      value={String(lastResult.equityPointCount ?? 0)}
                    />
                  </div>
                ) : null}
              </div>
            ) : (
              <EmptyState message="Run a backtest to see metrics here." />
            )}
          </div>
        </HubPane>

        <HubPane
          eyebrow="History"
          title="Saved runs"
          actions={
            <Button
              size="sm"
              variant="secondary"
              disabled={compareIds.length < 2 || busy}
              onClick={() => void compare()}
            >
              Compare ({compareIds.length})
            </Button>
          }
        >
          <ul className="m-0 list-none divide-y divide-hairline p-0">
            {loading && runs.length === 0 ? (
              <li className="p-4">
                <PanelLoading className="p-0" />
              </li>
            ) : null}
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
              const active = selectedRunId === run.id;
              return (
                <li
                  key={run.id}
                  className={`flex cursor-pointer items-center justify-between gap-2 px-4 py-2.5 hover:bg-surface2 ${active ? "bg-surface2" : ""}`}
                  onClick={() => setSelectedRunId(run.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") setSelectedRunId(run.id);
                  }}
                  role="button"
                  tabIndex={0}
                >
                  <div className="min-w-0">
                    <div className="truncate font-sans text-label text-text1">
                      {run.experienceId} · {run.verdict}
                      {run.engineVersion === 1 ? " · V1" : ""}
                    </div>
                    <div className="font-mono text-micro text-text3">
                      {fmt.time(run.createdAt)} · trades{" "}
                      {String(metrics.tradeCount ?? "—")}
                      {typeof metrics.netPnlUsd === "number"
                        ? ` · PnL ${fmt.usd(metrics.netPnlUsd)}`
                        : ` · sharpe ${String(metrics.sharpe ?? "—")}`}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="shrink-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleCompare(run.id);
                    }}
                  >
                    <Badge variant={selected ? "success" : "default"} size="sm">
                      {selected ? "compare" : run.contractHash.slice(0, 8)}
                    </Badge>
                  </button>
                </li>
              );
            })}
            {!loading && runs.length === 0 ? (
              <li className="p-4">
                <EmptyState message="No backtest runs yet." />
              </li>
            ) : null}
          </ul>
        </HubPane>

        {compareView ? (
          <HubPane eyebrow="Compare" title="Aligned metrics">
            <pre className="m-0 overflow-auto p-4 font-mono text-data text-text2">
              {JSON.stringify(compareView, null, 2)}
            </pre>
          </HubPane>
        ) : null}
      </div>
    </div>
  );
}

function BacktestEquityChart({ points }: { points: EquityPoint[] }) {
  const chart = useMemo(() => buildEquityChart(points), [points]);
  if (points.length === 0) {
    return <EmptyState message="No equity points." />;
  }
  return (
    <div>
      <div className="mb-2 font-mono text-micro uppercase tracking-wider text-text3">
        Equity & drawdown
      </div>
      <svg
        viewBox={`0 0 ${CHART_W} ${CHART_H}`}
        className="h-auto w-full max-w-full"
        role="img"
        aria-label="Backtest equity curve"
      >
        {chart.gridLines.map((y) => (
          <line
            key={y}
            x1={PAD.left}
            x2={CHART_W - PAD.right}
            y1={y}
            y2={y}
            stroke="currentColor"
            className="text-hairline"
            strokeWidth={0.5}
          />
        ))}
        {chart.yLabels.map((label) => (
          <text
            key={label.text}
            x={PAD.left - 4}
            y={label.y + 3}
            textAnchor="end"
            className="fill-text3 font-mono text-[9px]"
          >
            {label.text}
          </text>
        ))}
        <path
          d={chart.equityPath}
          fill="none"
          stroke="currentColor"
          className="text-success"
          strokeWidth={1.5}
        />
        <path
          d={chart.drawdownPath}
          fill="none"
          stroke="currentColor"
          className="text-warning"
          strokeWidth={1}
          strokeDasharray="4 3"
        />
      </svg>
      <div className="mt-1 font-mono text-micro text-text3">
        Solid = equity · dashed = drawdown %
      </div>
    </div>
  );
}

function buildEquityChart(points: EquityPoint[]) {
  const innerW = CHART_W - PAD.left - PAD.right;
  const innerH = CHART_H - PAD.top - PAD.bottom;
  const equities = points.map((p) => p.equityUsd);
  const drawdowns = points.map((p) => p.drawdownPct * 100);
  const min = Math.min(...equities, 0);
  const max = Math.max(...equities, ...drawdowns, 1);
  const span = max - min || 1;
  const toY = (v: number) => PAD.top + innerH - ((v - min) / span) * innerH;
  const toX = (i: number) =>
    PAD.left + (i / Math.max(1, points.length - 1)) * innerW;
  const line = (vals: number[]) =>
    vals
      .map(
        (v, i) =>
          `${i === 0 ? "M" : "L"}${toX(i).toFixed(1)},${toY(v).toFixed(1)}`,
      )
      .join(" ");
  return {
    equityPath: line(equities),
    drawdownPath: line(drawdowns),
    gridLines: [0, 0.5, 1].map((t) => PAD.top + innerH * (1 - t)),
    yLabels: [max, min + span * 0.5, min].map((v) => ({
      y: toY(v),
      text: v > 1000 ? fmt.usd(v, 0) : `${v.toFixed(1)}%`,
    })),
  };
}

function AssumptionsPanel({
  spec,
}: {
  spec: NonNullable<RunDetail["spec"]>;
}) {
  return (
    <div className="rounded-sm border border-hairline bg-surface2 p-3">
      <div className="font-mono text-micro uppercase tracking-wider text-text3">
        Assumptions
      </div>
      <dl className="mt-2 grid gap-1 font-mono text-micro text-text2">
        <div>
          Strategy: {spec.strategy.id} · folds {spec.folds.count} · purge{" "}
          {spec.folds.purgeBars}
        </div>
        <div>
          Costs: spread {spec.costs.spreadBps} bps · commission{" "}
          {spec.costs.commissionBps} bps · slippage {spec.costs.slippageBps} bps
        </div>
        <div>
          Symbols: {spec.instruments.map((i) => i.symbol).join(", ")} ·{" "}
          {spec.window.start.slice(0, 10)} → {spec.window.end.slice(0, 10)}
        </div>
      </dl>
    </div>
  );
}

function PromotionCriteriaPanel({ promotion }: { promotion: PromotionBlock }) {
  const entries = Object.entries(promotion.criteria ?? {});
  return (
    <div>
      <div className="mb-2 font-mono text-micro uppercase tracking-wider text-text3">
        Promotion criteria
        {promotion.promote != null ? (
          <span className="ml-2 normal-case text-text2">
            {promotion.promote ? "eligible" : "not eligible"}
          </span>
        ) : null}
      </div>
      <ul className="m-0 list-none divide-y divide-hairline rounded-sm border border-hairline p-0">
        {entries.map(([key, row]) => (
          <li
            key={key}
            className="flex items-start justify-between gap-2 px-3 py-2 font-mono text-micro"
          >
            <span className="text-text2">{key}</span>
            <span className={row.pass ? "text-success" : "text-error"}>
              {row.pass ? "pass" : "fail"} · {row.reason}
            </span>
          </li>
        ))}
      </ul>
      {promotion.dataQuality && promotion.dataQuality.length > 0 ? (
        <div className="mt-2 font-mono text-micro text-text3">
          Data quality:{" "}
          {promotion.dataQuality
            .map(
              (q) =>
                `${q.symbol} ${q.complete ? "ok" : q.blockers.join(",")}${q.provider ? ` · ${q.provider}${q.feed ? `/${q.feed}` : ""}` : ""}`,
            )
            .join(" · ")}
        </div>
      ) : null}
    </div>
  );
}

function FoldTable({ folds }: { folds: FoldMetric[] }) {
  return (
    <div>
      <div className="mb-2 font-mono text-micro uppercase tracking-wider text-text3">
        Folds
      </div>
      <div className="overflow-x-auto rounded-sm border border-hairline">
        <table className="w-full border-collapse font-mono text-micro text-text2">
          <thead>
            <tr className="border-b border-hairline bg-surface2 text-left text-text3">
              <th className="px-2 py-1.5">Fold</th>
              <th className="px-2 py-1.5">Trades</th>
              <th className="px-2 py-1.5">Exp bps</th>
              <th className="px-2 py-1.5">Max DD</th>
              <th className="px-2 py-1.5">Win rate</th>
            </tr>
          </thead>
          <tbody>
            {folds.map((f) => (
              <tr key={f.fold} className="border-b border-hairline last:border-0">
                <td className="px-2 py-1.5">{f.fold}</td>
                <td className="px-2 py-1.5">{f.tradeCount}</td>
                <td className="px-2 py-1.5">{f.expectancyBps.toFixed(1)}</td>
                <td className="px-2 py-1.5">
                  {(f.maxDrawdownPct * 100).toFixed(2)}%
                </td>
                <td className="px-2 py-1.5">{(f.winRate * 100).toFixed(0)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TradeLedger({ trades }: { trades: TradeRow[] }) {
  const sorted = [...trades].sort((a, b) => a.entryTs.localeCompare(b.entryTs));
  return (
    <div>
      <div className="mb-2 font-mono text-micro uppercase tracking-wider text-text3">
        Trade ledger ({sorted.length})
      </div>
      <div className="max-h-64 overflow-auto rounded-sm border border-hairline">
        <table className="w-full border-collapse font-mono text-micro text-text2">
          <thead className="sticky top-0 bg-surface2">
            <tr className="border-b border-hairline text-left text-text3">
              <th className="px-2 py-1.5">Symbol</th>
              <th className="px-2 py-1.5">Side</th>
              <th className="px-2 py-1.5">Qty</th>
              <th className="px-2 py-1.5">Notional</th>
              <th className="px-2 py-1.5">Net P&L</th>
              <th className="px-2 py-1.5">Ret bps</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((t) => {
              const notional = t.quantity * t.entryPrice;
              return (
                <tr key={t.id} className="border-b border-hairline last:border-0">
                  <td className="px-2 py-1.5">{t.symbol}</td>
                  <td className="px-2 py-1.5">{t.side}</td>
                  <td className="px-2 py-1.5">{t.quantity.toFixed(2)}</td>
                  <td className="px-2 py-1.5">{fmt.usd(notional)}</td>
                  <td
                    className={`px-2 py-1.5 ${t.realizedPnlUsd >= 0 ? "text-success" : "text-error"}`}
                  >
                    {fmt.usd(t.realizedPnlUsd)}
                  </td>
                  <td className="px-2 py-1.5">
                    {t.returnBps != null ? t.returnBps.toFixed(1) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
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
      <span className="font-mono text-micro uppercase tracking-wider text-text3">
        {label}
      </span>
      {children}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-sm border border-hairline bg-surface2 px-2 py-1.5">
      <div className="font-mono text-micro uppercase tracking-wider text-text3">
        {label}
      </div>
      <div className="font-mono text-label text-text1">{value}</div>
    </div>
  );
}
