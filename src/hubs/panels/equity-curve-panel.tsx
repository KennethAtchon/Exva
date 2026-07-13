import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/exva";
import { formatIpcError } from "@/lib/ipc-error";
import { useExvaEvent } from "@/hooks/useExvaEvent";
import { fmt } from "@/lib/formatters";
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

/**
 * Portfolio equity curve from equity_snapshots (finish-line 08 T5).
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
    // Intentional: reload when range changes; load closes over range.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range]);

  useExvaEvent("equity_snapshot", () => load(range));

  const path = useMemo(() => buildPath(points.map((p) => p.total)), [points]);
  const aiPath = useMemo(
    () =>
      showAiCost
        ? buildPath(points.map((p) => (p.total ?? 0) - (p.aiSpendUsd ?? 0)))
        : null,
    [points, showAiCost],
  );

  return (
    <div className={cn("flex flex-col gap-2 p-3", className)}>
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
                "rounded border px-2 py-0.5 font-mono text-[11px]",
                range === r
                  ? "border-[var(--accent)] text-[var(--text1)]"
                  : "border-[var(--border)] text-[var(--text3)]",
              )}
            >
              {r}
            </button>
          ))}
        </div>
        <div className="flex gap-3 font-mono text-[11px] text-[var(--text3)]">
          <span>
            Day{" "}
            <span
              className={(dayPnl ?? 0) >= 0 ? "text-success" : "text-error"}
            >
              {dayPnl != null ? fmt.pnl(dayPnl) : "—"}
            </span>
          </span>
          <span>
            Week{" "}
            <span
              className={(weekPnl ?? 0) >= 0 ? "text-success" : "text-error"}
            >
              {weekPnl != null ? fmt.pnl(weekPnl) : "—"}
            </span>
          </span>
          {stale ? <span className="text-warning">stale marks</span> : null}
        </div>
      </div>
      {points.length < 2 ? (
        <div className="flex h-[120px] items-center justify-center text-[12px] text-[var(--text3)]">
          No equity snapshots yet — they accumulate hourly and on trade close.
        </div>
      ) : (
        <svg viewBox="0 0 320 120" className="h-[120px] w-full">
          <path d={path} fill="none" stroke="var(--accent)" strokeWidth="1.5" />
          {aiPath ? (
            <path
              d={aiPath}
              fill="none"
              stroke="var(--color-warning)"
              strokeWidth="1"
              strokeDasharray="3 2"
            />
          ) : null}
        </svg>
      )}
      {showAiCost ? (
        <div className="font-mono text-[10px] text-[var(--text3)]">
          Solid = equity · dashed = net of AI spend
        </div>
      ) : null}
    </div>
  );
}

function buildPath(values: number[]): string {
  if (values.length === 0) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  return values
    .map((v, i) => {
      const x = (i / Math.max(1, values.length - 1)) * 320;
      const y = 110 - ((v - min) / span) * 100;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}
