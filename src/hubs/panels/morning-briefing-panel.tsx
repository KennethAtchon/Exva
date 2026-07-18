import { useEffect, useState } from "react";
import { api } from "@/lib/exva";
import { formatIpcError } from "@/lib/ipc-error";
import { HubEmptyState, HubPane, HubQueryError } from "@/hubs/dna";
import { Button } from "@/components/ui";
import { PanelLoading } from "@/components/ui/skeleton";
import { fmt } from "@/lib/formatters";

type Briefing = {
  date: string;
  narrative: string;
  doc: {
    yesterdayPnlUsd: number;
    openPositions: number;
    tradesOpened: number;
    tradesClosed: number;
    dataCoverageStatus: string;
    aiSpendUsd: number;
    aiBudgetUsd: number;
    alarms: Array<{ kind: string; message: string }>;
    calendarEvents: Array<{
      title: string;
      scheduledAt: string;
      symbol: string | null;
    }>;
  };
};

export function MorningBriefingPanel() {
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    void api
      .briefingLatest()
      .then((r) => {
        setBriefing(r.briefing as Briefing | null);
        setError(null);
      })
      .catch((err) => {
        setError(formatIpcError(err).display);
        setBriefing(null);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  return (
    <HubPane
      eyebrow="Digest"
      title="Morning briefing"
      actions={
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void api
              .briefingAssemble()
              .then((r) => setBriefing(r.briefing as Briefing))
              .finally(() => setBusy(false));
          }}
        >
          Assemble now
        </Button>
      }
    >
      {loading && !briefing && !error ? (
        <PanelLoading />
      ) : !briefing ? (
        error ? (
          <HubQueryError message={error} onRetry={load} />
        ) : (
          <HubEmptyState
            title="No briefing yet"
            body="Nightly digest assembles one automatically — or tap Assemble now."
            className="py-6"
          />
        )
      ) : (
        <div className="flex flex-col gap-2 px-4 py-3">
          <div className="font-mono text-micro text-text3">{briefing.date}</div>
          <p className="m-0 text-body leading-relaxed text-text1">
            {briefing.narrative}
          </p>
          <div className="flex flex-wrap gap-3 font-mono text-micro text-text2">
            <span>P&L {fmt.pnl(briefing.doc.yesterdayPnlUsd)}</span>
            <span>
              {briefing.doc.tradesOpened}o / {briefing.doc.tradesClosed}c
            </span>
            <span>{briefing.doc.openPositions} open</span>
            <span>
              AI {fmt.usd(briefing.doc.aiSpendUsd)} /{" "}
              {fmt.usd(briefing.doc.aiBudgetUsd)}
            </span>
          </div>
          <div className="text-micro text-text3">
            {briefing.doc.dataCoverageStatus}
          </div>
          {briefing.doc.alarms[0] ? (
            <div className="text-micro text-warning">
              Alarm: {briefing.doc.alarms[0].message}
            </div>
          ) : null}
        </div>
      )}
    </HubPane>
  );
}
