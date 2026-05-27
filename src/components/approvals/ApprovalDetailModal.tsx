import { useState } from "react";
import { Badge } from "@/components/custom-ui";
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui";
import { fmt } from "@/lib/formatters";
import type { ApprovalSummary } from "@/lib/types";

type Props = {
  approval: ApprovalSummary | null;
  workspaceViewMode: "session" | "global";
  onClose: () => void;
  onDecide: (input: {
    id: string;
    decision: "approved" | "rejected";
    decisionNote?: string;
  }) => Promise<{ status: "approved" | "rejected"; resolvedAt: string }>;
};

export const ApprovalDetailModal = ({
  approval,
  workspaceViewMode,
  onClose,
  onDecide,
}: Props) => {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!approval) return null;

  let summary: Record<string, unknown> = {};
  try {
    summary = JSON.parse(approval.decisionSummaryJson) as Record<
      string,
      unknown
    >;
  } catch {
    summary = {};
  }

  const showRecheckNote = approval.status === "pending";

  const run = async (decision: "approved" | "rejected") => {
    setBusy(decision === "approved" ? "approve" : "reject");
    setError(null);
    try {
      await onDecide({
        id: approval.id,
        decision,
        decisionNote: note.trim() || undefined,
      });
      setNote("");
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto rounded-[14px] border-border bg-[var(--surface)] p-6 sm:max-w-[480px]">
        <DialogHeader className="space-y-0">
          <div className="flex items-start justify-between gap-3">
            <div>
              <DialogTitle
                id="approval-detail-title"
                className="text-lg text-[var(--text1)]"
              >
                {approval.instrumentSymbol}
              </DialogTitle>
              {approval.instrumentDisplayName ? (
                <p className="mt-1.5 text-[12px] text-[var(--text2)]">
                  {approval.instrumentDisplayName}
                </p>
              ) : null}
              <p className="mt-1.5 text-[12px] text-[var(--text3)]">
                {approval.predictionOutcome
                  ? `${approval.predictionOutcome} · `
                  : ""}
                {approval.proposedSide} · {fmt.usd(approval.proposedSizeUsd, 0)}{" "}
                · {approval.brokerName}
              </p>
            </div>
            <Badge
              variant={approval.status === "pending" ? "warn" : "default"}
              size="sm"
            >
              {approval.status}
            </Badge>
          </div>
        </DialogHeader>

        {workspaceViewMode === "global" && (
          <p className="mt-3 text-[12px] text-[var(--text2)]">
            Session:{" "}
            <strong className="text-[var(--text1)]">
              {approval.sessionName}
            </strong>
          </p>
        )}

        <SessionHorizonSection value={summary.sessionHorizon} />

        <div className="mt-4 rounded-[10px] border border-[var(--border)] bg-[var(--surface2)] p-3">
          <div className="mb-1.5 text-[12px] text-[var(--text3)]">
            Decision snapshot
          </div>
          {typeof summary.reasoning === "string" && (
            <p className="text-[13px] leading-[1.5] text-[var(--text2)]">
              {summary.reasoning}
            </p>
          )}
          {typeof summary.riskNote === "string" && summary.riskNote && (
            <p className="mt-2.5 text-[12px] text-[var(--text3)]">
              Risk: {String(summary.riskNote)}
            </p>
          )}
        </div>

        {showRecheckNote && (
          <p className="mt-3.5 text-[12px] leading-[1.45] text-warning">
            If this approval was created before the current session run,
            approving will re-run decision and risk checks before any order is
            sent.
          </p>
        )}

        <label className="mt-3.5 block text-[12px] text-[var(--text3)]">
          Note (optional)
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={2}
            className="mt-1 block w-full resize-y rounded-lg border border-border bg-[var(--surface)] p-2 text-[13px] text-[var(--text1)]"
          />
        </label>

        {error && <p className="mt-2.5 text-[12px] text-error">{error}</p>}

        <div className="mt-[18px] flex justify-end gap-2.5">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={busy != null}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="outline"
            className="border-error-border text-error hover:bg-error-dim hover:text-error"
            onClick={() => void run("rejected")}
            disabled={busy != null || approval.status !== "pending"}
          >
            {busy === "reject" ? "…" : "Reject"}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="border-success-border text-success hover:bg-success-dim hover:text-success"
            onClick={() => void run("approved")}
            disabled={busy != null || approval.status !== "pending"}
          >
            {busy === "approve" ? "…" : "Approve"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

function SessionHorizonSection({ value }: { value: unknown }) {
  if (!value || typeof value !== "object") return null;
  const h = value as Record<string, unknown>;
  const tf =
    typeof h.primaryTradingTimeframe === "string"
      ? h.primaryTradingTimeframe
      : null;
  const hs = typeof h.holdingStyle === "string" ? h.holdingStyle : null;
  if (!tf && !hs) return null;
  const target = h.targetHoldDays;
  const max = h.maxHoldDays;
  const notes =
    typeof h.timeframeNotes === "string" && h.timeframeNotes.trim()
      ? h.timeframeNotes.trim()
      : null;
  return (
    <div className="mt-1 rounded-[10px] border border-info-border bg-info-dim p-3">
      <div className="mb-2 text-[12px] text-[var(--text3)]">
        Session trading horizon
      </div>
      <ul className="m-0 list-disc pl-[18px] text-[12px] leading-[1.55] text-[var(--text2)]">
        {tf ? <li>Primary timeframe: {tf}</li> : null}
        {hs ? <li>Holding style: {hs}</li> : null}
        {typeof target === "number" ? (
          <li>Target hold: ~{target} days</li>
        ) : null}
        {typeof max === "number" ? <li>Max hold: {max} days</li> : null}
        {notes ? <li>Notes: {notes}</li> : null}
      </ul>
    </div>
  );
}
