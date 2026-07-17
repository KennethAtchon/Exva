import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/exva";
import { formatIpcError } from "@/lib/ipc-error";
import { HubQueryError } from "@/hubs/dna";
import { Button } from "@/components/ui";
import { EmptyState, SectionHeader } from "@/components/ui/primitives";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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

type CheckRow = {
  id: string;
  name: string;
  pass: boolean;
  detail: string;
  action?: React.ReactNode;
};

/**
 * Data Doctor — coverage checks and provider health.
 */
export function DataDoctorPanel() {
  const [cells, setCells] = useState<Cell[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [runningChecks, setRunningChecks] = useState(false);
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

  const runChecks = async () => {
    setRunningChecks(true);
    setMessage(null);
    try {
      const result = await api.dataDoctorRunNightlyGapCheck();
      setMessage(
        `Gap check complete · ${result.cellsWithGaps} cells with gaps`,
      );
      refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setRunningChecks(false);
    }
  };

  const checks = buildChecks(cells, providers, backfill, busy, refresh);

  return (
    <div className="flex flex-col gap-4">
      <SectionHeader
        eyebrow="Diagnostics"
        title="Data doctor"
        action={
          <Button
            size="sm"
            disabled={runningChecks}
            onClick={() => void runChecks()}
          >
            {runningChecks ? "Running…" : "Run checks"}
          </Button>
        }
      />

      {loadError ? (
        <HubQueryError message={loadError} onRetry={refresh} />
      ) : null}
      {message ? (
        <div className="font-mono text-caption text-text2">{message}</div>
      ) : null}

      {checks.length === 0 && !loadError ? (
        <EmptyState message="No coverage rows yet. Ingest bars or run a session first, then run checks." />
      ) : (
        <div className="overflow-hidden rounded-sm border border-border bg-surface">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Check</TableHead>
                <TableHead className="w-16 text-center">Status</TableHead>
                <TableHead>Detail</TableHead>
                <TableHead className="w-24 text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {checks.map((check) => (
                <TableRow key={check.id}>
                  <TableCell className="font-sans text-label text-text1">
                    {check.name}
                  </TableCell>
                  <TableCell className="text-center">
                    <StatusDot pass={check.pass} />
                  </TableCell>
                  <TableCell className="font-mono text-data text-text2">
                    {check.detail}
                  </TableCell>
                  <TableCell className="text-right">{check.action}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function StatusDot({ pass }: { pass: boolean }) {
  return (
    <span
      className={cn(
        "inline-block h-2 w-2 rounded-full",
        pass ? "bg-success" : "bg-error",
      )}
      title={pass ? "Pass" : "Fail"}
    />
  );
}

function buildChecks(
  cells: Cell[],
  providers: Provider[],
  backfill: (cell: Cell) => Promise<void>,
  busy: string | null,
  refresh: () => void,
): CheckRow[] {
  const rows: CheckRow[] = [];

  for (const p of providers) {
    const pass =
      p.enabled &&
      p.successCount24h > 0 &&
      p.errorRate < 0.1 &&
      p.lastSuccessAt != null;
    rows.push({
      id: `provider-${p.provider}`,
      name: `Provider · ${p.provider}`,
      pass,
      detail: p.enabled
        ? `err ${(p.errorRate * 100).toFixed(0)}% · ${p.successCount24h} ok / ${p.errorCount24h} err`
        : "disabled",
      action: (
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
      ),
    });
  }

  for (const cell of cells) {
    const freshPass = cell.freshness === "fresh";
    rows.push({
      id: `fresh-${cell.symbol}-${cell.timeframe}`,
      name: `Freshness · ${cell.symbol}/${cell.timeframe}`,
      pass: freshPass,
      detail: `${cell.freshness} · ${cell.provider} · ${cell.lastTs.slice(0, 16)}`,
    });

    const gapPass = cell.gapCount === 0;
    rows.push({
      id: `gap-${cell.symbol}-${cell.timeframe}`,
      name: `Gaps · ${cell.symbol}/${cell.timeframe}`,
      pass: gapPass,
      detail: gapPass
        ? "no gaps"
        : `${cell.gapCount} gap${cell.gapCount === 1 ? "" : "s"}`,
      action: (
        <Button
          size="sm"
          variant="ghost"
          disabled={busy === `${cell.symbol}:${cell.timeframe}`}
          onClick={() => void backfill(cell)}
        >
          Backfill
        </Button>
      ),
    });
  }

  return rows;
}
