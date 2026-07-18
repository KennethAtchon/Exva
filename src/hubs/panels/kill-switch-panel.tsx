import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/exva";
import { formatIpcError } from "@/lib/ipc-error";
import { HubPane, HubQueryError } from "@/hubs/dna";
import { Button, Input } from "@/components/ui";
import { Badge } from "@/components/custom-ui";
import { EmptyState } from "@/components/ui/primitives";
import { PanelLoading } from "@/components/ui/skeleton";
import { formatPercent } from "@/lib/format";
import { fmt } from "@/lib/formatters";
import { cn } from "@/lib/utils";

type Gauge = {
  sessionId: string;
  sessionName: string;
  status: string;
  dailyPnlUsd: number;
  dailyLossLimitUsd: number;
  drawdownFraction: number;
  maxDrawdownFraction: number;
  liveReadiness: {
    readyToStart: boolean;
    acknowledgedAt: string | null;
  } | null;
};

/**
 * Kill-switch & live-readiness panel (finish-line 08 T7).
 */
export function KillSwitchPanel() {
  const [gauges, setGauges] = useState<Gauge[]>([]);
  const [flattenText, setFlattenText] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    void api
      .killSwitchGauges()
      .then((r) => {
        setGauges(r.gauges as Gauge[]);
        setLoadError(null);
      })
      .catch((err) => {
        setLoadError(formatIpcError(err).display);
        setGauges([]);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [refresh]);

  return (
    <HubPane
      eyebrow="Emergency"
      title="Kill switch"
      className="border-error/40"
      actions={
        <Button
          variant="destructive"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void api
              .killSwitchPauseAll()
              .then((r) => {
                setMessage(
                  `Paused ${r.paused.length}; skipped ${r.skipped.length}`,
                );
                refresh();
              })
              .catch((err) =>
                setMessage(err instanceof Error ? err.message : String(err)),
              )
              .finally(() => setBusy(false));
          }}
        >
          Pause all
        </Button>
      }
    >
      <div className="flex flex-col gap-3 p-3">
        {loadError ? (
          <HubQueryError message={loadError} onRetry={refresh} />
        ) : null}
        {message ? (
          <div className="font-mono text-micro text-text2">{message}</div>
        ) : null}
        {loading && gauges.length === 0 && !loadError ? (
          <PanelLoading className="p-0" />
        ) : null}
        <ul className="m-0 list-none divide-y divide-border p-0">
          {gauges.map((g) => {
            const lossPct =
              g.dailyLossLimitUsd > 0
                ? Math.min(
                    1,
                    Math.abs(Math.min(0, g.dailyPnlUsd)) / g.dailyLossLimitUsd,
                  )
                : 0;
            const ddPct =
              g.maxDrawdownFraction > 0
                ? Math.min(1, g.drawdownFraction / g.maxDrawdownFraction)
                : 0;
            return (
              <li
                key={g.sessionId}
                className="flex flex-col gap-2 px-1 py-2.5 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-body font-medium text-text1">
                      {g.sessionName}
                    </span>
                    <Badge size="sm" variant="default">
                      {g.status}
                    </Badge>
                    {g.liveReadiness ? (
                      <Badge
                        size="sm"
                        variant={
                          g.liveReadiness.readyToStart ? "success" : "default"
                        }
                      >
                        {g.liveReadiness.readyToStart ? "live ack" : "no ack"}
                      </Badge>
                    ) : null}
                  </div>
                  <div className="mt-1 flex gap-3 font-mono text-micro text-text3">
                    <GaugeBar
                      label="Day loss"
                      pct={lossPct}
                      value={fmt.pnl(g.dailyPnlUsd)}
                    />
                    <GaugeBar
                      label="DD"
                      pct={ddPct}
                      value={formatPercent(g.drawdownFraction, 1)}
                    />
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={
                    busy || g.status === "paused" || g.status === "draft"
                  }
                  onClick={() => {
                    setBusy(true);
                    void api
                      .killSwitchKillSession(g.sessionId)
                      .then(() => refresh())
                      .finally(() => setBusy(false));
                  }}
                >
                  Kill
                </Button>
              </li>
            );
          })}
          {!loading && gauges.length === 0 && !loadError ? (
            <li className="list-none px-0 py-2">
              <EmptyState
                title="No sessions to monitor"
                message="Start or resume a session to see kill-switch gauges here."
                className="border-0 bg-transparent p-2"
              />
            </li>
          ) : null}
        </ul>

        <div className="rounded-sm border border-error/30 bg-error-dim/30 p-3">
          <div className="mb-2 text-caption font-medium text-error">
            Flatten everything
          </div>
          <div className="mb-2 text-micro text-text2">
            Market-closes every open position through the normal gate chain.
            Type FLATTEN to enable.
          </div>
          <div className="flex gap-2">
            <Input
              value={flattenText}
              onChange={(e) => setFlattenText(e.target.value)}
              placeholder="FLATTEN"
              className="font-mono"
            />
            <Button
              variant="destructive"
              disabled={busy || flattenText !== "FLATTEN"}
              onClick={() => {
                setBusy(true);
                void api
                  .killSwitchFlattenAll(flattenText)
                  .then((r) => {
                    setMessage(
                      `Flattened ${r.closed.length}; failed ${r.failed.length}`,
                    );
                    setFlattenText("");
                    refresh();
                  })
                  .catch((err) =>
                    setMessage(
                      err instanceof Error ? err.message : String(err),
                    ),
                  )
                  .finally(() => setBusy(false));
              }}
            >
              Flatten
            </Button>
          </div>
        </div>
      </div>
    </HubPane>
  );
}

function GaugeBar({
  label,
  pct,
  value,
}: {
  label: string;
  pct: number;
  value: string;
}) {
  return (
    <div className="flex min-w-[100px] flex-col gap-0.5">
      <div className="flex justify-between">
        <span>{label}</span>
        <span className={cn(pct > 0.8 ? "text-error" : "text-text2")}>
          {value}
        </span>
      </div>
      <div className="h-1 overflow-hidden rounded bg-surface3">
        <div
          className={cn(
            "h-full",
            pct > 0.8 ? "bg-error" : pct > 0.5 ? "bg-warning" : "bg-success",
          )}
          style={{ width: `${Math.round(pct * 100)}%` }}
        />
      </div>
    </div>
  );
}
