/**
 * Paper certification arming panel (Solution 01).
 * Arms a $10 SPY paper round-trip — not a strategy trade.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/lib/exva";
import { useExvaEvent } from "@/hooks/useExvaEvent";
import type { PaperCertificationRun } from "@electron/shared/domain/paper-certification";

function formatEquityFeedLabel(feed: string | null | undefined): string {
  if (!feed) return "IEX (default until SIP probe)";
  return feed.toUpperCase();
}

export function PaperCertificationPanel(props: {
  sessionId: string;
  brokerAccountId: string;
  brokerAccountName: string;
}) {
  const qc = useQueryClient();
  const [runId, setRunId] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const feedQuery = useQuery({
    queryKey: ["paperCertFeed"],
    queryFn: async () => {
      const coverage = (await api.dataDoctorCoverage()) as {
        cells: Array<{ symbol: string; feed?: string | null }>;
      };
      return (
        coverage.cells.find((c) => c.symbol === "SPY")?.feed ??
        coverage.cells.find((c) => c.feed)?.feed ??
        null
      );
    },
  });

  const runQuery = useQuery({
    queryKey: ["paperCertification", runId],
    enabled: Boolean(runId),
    queryFn: async () => {
      if (!runId) return null;
      return api.paperCertification.get(runId) as Promise<PaperCertificationRun>;
    },
    refetchInterval: (q) => {
      const status = q.state.data?.status;
      if (!status) return false;
      if (
        status === "closed" ||
        status === "failed" ||
        status === "reconciliation_required"
      ) {
        return false;
      }
      return 2_000;
    },
  });

  useExvaEvent("paper_certification_updated", (payload) => {
    const run = payload as PaperCertificationRun;
    if (runId && run.id === runId) {
      void qc.setQueryData(["paperCertification", runId], run);
    }
  });

  const arm = useMutation({
    mutationFn: () =>
      api.paperCertification.arm({
        sessionId: props.sessionId,
        brokerAccountId: props.brokerAccountId,
      }) as Promise<PaperCertificationRun>,
    onSuccess: (run) => {
      setRunId(run.id);
      setConfirmOpen(false);
      void qc.setQueryData(["paperCertification", run.id], run);
    },
  });

  const reconcile = useMutation({
    mutationFn: () => {
      if (!runId) throw new Error("No run");
      return api.paperCertification.reconcile(runId) as Promise<PaperCertificationRun>;
    },
    onSuccess: (run) => {
      void qc.setQueryData(["paperCertification", run.id], run);
    },
  });

  const run = runQuery.data;

  return (
    <div className="grid gap-3 p-4">
      <div>
        <h2 className="text-lg font-semibold">Paper execution certification</h2>
        <p className="text-sm text-muted-foreground">
          Infrastructure proof only — not a strategy trade. Places one $10 SPY
          market buy on paper Alpaca and closes the filled quantity.
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-2 text-sm">
        <dt>Broker</dt>
        <dd>
          {props.brokerAccountName} ({props.brokerAccountId})
        </dd>
        <dt>Symbol</dt>
        <dd>SPY</dd>
        <dt>Notional</dt>
        <dd>$10</dd>
        <dt>Mode</dt>
        <dd>paper_only</dd>
        <dt>Equity data feed</dt>
        <dd>{formatEquityFeedLabel(feedQuery.data)}</dd>
      </dl>

      {!confirmOpen ? (
        <button
          type="button"
          className="rounded border border-border px-3 py-2 text-sm"
          onClick={() => setConfirmOpen(true)}
          disabled={arm.isPending}
        >
          Arm paper certification
        </button>
      ) : (
        <div className="grid gap-2 rounded border border-border p-3 text-sm">
          <p>
            Confirm one $10 SPY buy on {props.brokerAccountName} (
            {props.brokerAccountId}), paper only, with automatic close. This is
            not a strategy trade.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded border border-border px-3 py-1"
              onClick={() => arm.mutate()}
              disabled={arm.isPending}
            >
              {arm.isPending ? "Arming…" : "Confirm arm"}
            </button>
            <button
              type="button"
              className="rounded border border-border px-3 py-1"
              onClick={() => setConfirmOpen(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {arm.isError ? (
        <p className="text-sm text-destructive" role="alert">
          {arm.error instanceof Error ? arm.error.message : "Arm failed"}
        </p>
      ) : null}

      {run ? (
        <div className="grid gap-1 rounded border border-border p-3 text-sm">
          <div>
            Status: <strong>{run.status}</strong>
          </div>
          <div>Entry client: {run.entryClientOrderId}</div>
          <div>Entry broker: {run.entryBrokerOrderId ?? "—"}</div>
          <div>Exit client: {run.exitClientOrderId ?? "—"}</div>
          <div>Exit broker: {run.exitBrokerOrderId ?? "—"}</div>
          <div>Filled qty: {run.filledQuantity}</div>
          {run.failureMessage ? (
            <div className="text-destructive">{run.failureMessage}</div>
          ) : null}
          <p className="text-muted-foreground">
            Receipt: paper-simulation integration certified — not strategy
            validated. Alpaca paper does not model market impact or live costs.
          </p>
          <button
            type="button"
            className="mt-2 w-fit rounded border border-border px-3 py-1"
            onClick={() => reconcile.mutate()}
            disabled={reconcile.isPending}
          >
            Reconcile now
          </button>
        </div>
      ) : null}
    </div>
  );
}
