import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/exva";
import { formatIpcError } from "@/lib/ipc-error";
import { useExvaEvent } from "@/hooks/useExvaEvent";
import { fmt } from "@/lib/formatters";
import { PnL } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { HubQueryError } from "@/hubs/dna";

type Range = "1W" | "1M" | "3M" | "all";

type Point = {
  ts: string;
  total: number;
  aiSpendUsd?: number;
  marksStale?: boolean;
};

type Props = {
  showAiCost?: boolean;
  className?: string;
};

const CHART_W = 320;
const CHART_H = 140;
const PAD = { top: 12, right: 8, bottom: 22, left: 44 };

/**
 * Portfolio equity curve from equity_snapshots.
 */
export function EquityCurvePanel({ showAiCost = false, className }: Props) {
  const [range, setRange] = useState<Range>("1M");
  const [points, setPoints] = useState<Point[]>([]);
  const [dayPnl, setDayPnl] = useState<number | null>(null);
  const [weekPnl, setWeekPnl] = useState<number | null>(null);
  const [stale, setStale] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = (r: Range = range) => {
    void api
      .equityCurve(r)
      .then((res) => {
        const data = res as {
          points: Point[];
          dayPnl: number | null;
          weekPnl: number | null;
          latest: Point | null;
        };
        setPoints(data.points ?? []);
        setDayPnl(data.dayPnl);
        setWeekPnl(data.weekPnl);
        setStale(Boolean(data.latest?.marksStale));
        setLoadError(null);
      })
      .catch((err) => {
        setLoadError(formatIpcError(err).display);
        setPoints([]);
        setDayPnl(null);
        setWeekPnl(null);
      });
  };

  useEffect(() => {
    load(range);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range]);

  useExvaEvent("equity_snapshot", () => load(range));

  const values = points.map((p) => p.total);
  // Cumulative AI spend is already stored on each snapshot; subtract it
  // (do not use a single day's spend as if it were the curve offset).
  const netValues = showAiCost
    ? points.map((p) => (p.total ?? 0) - (p.aiSpendUsd ?? 0))
    : null;

  const chart = useMemo(
    () => buildChartModel(values, netValues),
    [values, netValues],
  );

  const trendUp = values.length >= 2 && values[values.length - 1] >= values[0];

  return (
    <div className={cn("flex flex-col gap-3 p-4", className)}>
      {loadError ? (
        <HubQueryError message={loadError} onRetry={() => load(range)} />
      ) : null}
      <div className="flex items-center justify-between gap-2">
        <div className="flex gap-1">
          {(["1W", "1M", "3M", "all"] as Range[]).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              className={cn(
                "rounded-sm border px-2 py-0.5 font-mono text-micro transition-colors duration-hover",
                range === r
                  ? "border-hairline bg-surface2 text-text1"
                  : "border-transparent text-text3 hover:text-text2",
              )}
            >
              {r}
            </button>
          ))}
        </div>
        <div className="flex gap-3 font-mono text-micro text-text3">
          <span>
            Day{" "}
            {dayPnl != null ? (
              <PnL value={dayPnl} size="body" className="inline text-micro" />
            ) : (
              "—"
            )}
          </span>
          <span>
            Week{" "}
            {weekPnl != null ? (
              <PnL value={weekPnl} size="body" className="inline text-micro" />
            ) : (
              "—"
            )}
          </span>
          {stale ? <span className="text-warning">stale marks</span> : null}
        </div>
      </div>

      {points.length < 2 ? (
        <div className="flex h-36 items-center justify-center rounded-sm border border-border bg-bg font-sans text-caption text-text3">
          No equity snapshots yet — they accumulate hourly and on trade close.
        </div>
      ) : (
        <div className="rounded-sm border border-border bg-bg p-2">
          <svg
            viewBox={`0 0 ${CHART_W} ${CHART_H}`}
            className="h-36 w-full"
            role="img"
            aria-label="Equity curve"
          >
            {chart.gridLines.map((y, i) => (
              <line
                key={i}
                x1={PAD.left}
                x2={CHART_W - PAD.right}
                y1={y}
                y2={y}
                stroke="currentColor"
                className="text-hairline"
                strokeWidth={1}
              />
            ))}
            {chart.yLabels.map((label) => (
              <text
                key={label.y}
                x={PAD.left - 6}
                y={label.y + 3}
                textAnchor="end"
                className="fill-text3 font-mono text-micro"
              >
                {label.text}
              </text>
            ))}
            {chart.path ? (
              <path
                d={chart.path}
                fill="none"
                strokeWidth={1.5}
                className={trendUp ? "stroke-success" : "stroke-error"}
              />
            ) : null}
            {showAiCost && chart.netPath ? (
              <path
                d={chart.netPath}
                fill="none"
                strokeWidth={1.5}
                strokeDasharray="4 3"
                className="stroke-warning"
              />
            ) : null}
          </svg>
        </div>
      )}
      {showAiCost ? (
        <div className="font-mono text-micro text-text3">
          Solid = equity · dashed = net of AI spend
        </div>
      ) : null}
    </div>
  );
}

function buildChartModel(values: number[], netValues: number[] | null) {
  const innerW = CHART_W - PAD.left - PAD.right;
  const innerH = CHART_H - PAD.top - PAD.bottom;

  if (values.length === 0) {
    return {
      path: "",
      netPath: null,
      gridLines: [] as number[],
      yLabels: [] as Array<{ y: number; text: string }>,
    };
  }

  const allVals = netValues ? [...values, ...netValues] : values;
  const min = Math.min(...allVals);
  const max = Math.max(...allVals);
  const span = max - min || 1;

  const toY = (v: number) => PAD.top + innerH - ((v - min) / span) * innerH;
  const toX = (i: number) =>
    PAD.left + (i / Math.max(1, values.length - 1)) * innerW;

  const path = values
    .map(
      (v, i) =>
        `${i === 0 ? "M" : "L"}${toX(i).toFixed(1)},${toY(v).toFixed(1)}`,
    )
    .join(" ");

  const netPath =
    netValues && netValues.length > 0
      ? netValues
          .map(
            (v, i) =>
              `${i === 0 ? "M" : "L"}${toX(i).toFixed(1)},${toY(v).toFixed(1)}`,
          )
          .join(" ")
      : null;

  const gridLines = [0, 0.25, 0.5, 0.75, 1].map(
    (t) => PAD.top + innerH * (1 - t),
  );

  const yLabels = [max, min + span * 0.5, min].map((v) => ({
    y: toY(v),
    text: fmt.usd(v, 0),
  }));

  return { path, netPath, gridLines, yLabels };
}
