import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/exva";
import { formatIpcError } from "@/lib/ipc-error";
import { HubPane, HubQueryError } from "@/hubs/dna";
import { Button } from "@/components/ui";
import { cn } from "@/lib/utils";

type Cell = {
  symbol: string;
  timeframe: string;
  provider: string;
  freshness: "fresh" | "stale" | "dead" | "unknown";
  lagMs: number | null;
  gapCount: number;
  lastTs: string;
};

type Provider = {
  provider: string;
  lastSuccessAt: string | null;
  errorRate: number;
  errorCount24h: number;
  successCount24h: number;
  enabled: boolean;
};

/**
 * Data Doctor — coverage matrix, gaps, backfill, provider health (08 T3).
 */
export function DataDoctorPanel() {
  const [cells, setCells] = useState<Cell[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    void Promise.all([api.dataDoctorCoverage(), api.dataDoctorProviderHealth()])
      .then(([coverage, health]) => {
        setCells(coverage.cells as Cell[]);
        setProviders(health.providers as Provider[]);
        setLoadError(null);
      })
      .catch((err) => {
        setLoadError(formatIpcError(err).display);
      });
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const backfill = async (cell: Cell) => {
    setBusy(`${cell.symbol}:${cell.timeframe}`);
    setMessage(null);
    try {
      const result = (await api.dataDoctorBackfill({
        symbol: cell.symbol,
        timeframe: cell.timeframe,
        provider: cell.provider === "manual" ? "alpaca" : cell.provider,
      })) as { fetched: number; gapsRemaining: number };
      setMessage(
        `Backfill ${cell.symbol}/${cell.timeframe}: ${result.fetched} bars, ${result.gapsRemaining} gaps remain`,
      );
      refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[12px] text-[var(--text2)]">
          Coverage vs freshness. Gaps are holes inside claimed ranges.
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              void api.dataDoctorRunNightlyGapCheck().then((r) => {
                setMessage(`Gap check: ${r.cellsWithGaps} cells with gaps`);
                refresh();
              });
            }}
          >
            Run gap check
          </Button>
          <Button size="sm" variant="outline" onClick={refresh}>
            Refresh
          </Button>
        </div>
      </div>
      {loadError ? (
        <HubQueryError message={loadError} onRetry={refresh} />
      ) : null}
      {message ? (
        <div className="font-mono text-[12px] text-[var(--text2)]">
          {message}
        </div>
      ) : null}

      <HubPane eyebrow="Matrix" title="Symbols × timeframes">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-left text-[12px]">
            <thead>
              <tr className="border-b border-[var(--border)] text-[var(--text3)]">
                <th className="px-3 py-2 font-mono font-semibold">Symbol</th>
                <th className="px-3 py-2 font-mono font-semibold">TF</th>
                <th className="px-3 py-2 font-mono font-semibold">Freshness</th>
                <th className="px-3 py-2 font-mono font-semibold">Gaps</th>
                <th className="px-3 py-2 font-mono font-semibold">Provider</th>
                <th className="px-3 py-2 font-mono font-semibold">Last</th>
                <th className="px-3 py-2 font-mono font-semibold" />
              </tr>
            </thead>
            <tbody>
              {cells.map((cell) => (
                <tr
                  key={`${cell.symbol}:${cell.timeframe}`}
                  className="border-b border-[var(--border)]"
                >
                  <td className="px-3 py-2 font-mono font-semibold text-[var(--text1)]">
                    {cell.symbol}
                  </td>
                  <td className="px-3 py-2 font-mono text-[var(--text2)]">
                    {cell.timeframe}
                  </td>
                  <td className="px-3 py-2">
                    <FreshnessBadge freshness={cell.freshness} />
                  </td>
                  <td className="px-3 py-2 font-mono text-[var(--text2)]">
                    {cell.gapCount}
                  </td>
                  <td className="px-3 py-2 font-mono text-[var(--text3)]">
                    {cell.provider}
                  </td>
                  <td className="px-3 py-2 font-mono text-[var(--text3)]">
                    {cell.lastTs.slice(0, 16)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy === `${cell.symbol}:${cell.timeframe}`}
                      onClick={() => void backfill(cell)}
                    >
                      Backfill
                    </Button>
                  </td>
                </tr>
              ))}
              {cells.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-3 py-8 text-center text-[var(--text3)]"
                  >
                    No coverage rows yet. Ingest bars or run a session first.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </HubPane>

      <HubPane eyebrow="Providers" title="Health (24h)">
        <ul className="m-0 list-none divide-y divide-[var(--border)] p-0">
          {providers.map((p) => (
            <li
              key={p.provider}
              className="flex items-center justify-between gap-3 px-4 py-2.5"
            >
              <div>
                <div className="font-mono text-[13px] text-[var(--text1)]">
                  {p.provider}
                </div>
                <div className="font-mono text-[11px] text-[var(--text3)]">
                  err {(p.errorRate * 100).toFixed(0)}% · {p.successCount24h} ok
                  / {p.errorCount24h} err · last{" "}
                  {p.lastSuccessAt?.slice(0, 16) ?? "—"}
                </div>
              </div>
              <Button
                size="sm"
                variant={p.enabled ? "outline" : "destructive"}
                onClick={() => {
                  void api
                    .dataDoctorSetProviderEnabled(p.provider, !p.enabled)
                    .then(refresh);
                }}
              >
                {p.enabled ? "Disable" : "Enable"}
              </Button>
            </li>
          ))}
        </ul>
      </HubPane>
    </div>
  );
}

function FreshnessBadge({ freshness }: { freshness: Cell["freshness"] }) {
  return (
    <span
      className={cn(
        "inline-flex rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase",
        freshness === "fresh" && "bg-success-dim text-success",
        freshness === "stale" && "bg-warning-dim text-warning",
        freshness === "dead" && "bg-error-dim text-error",
        freshness === "unknown" && "bg-[var(--surface3)] text-[var(--text3)]",
      )}
    >
      {freshness}
    </span>
  );
}
