import { useState, type ReactNode } from "react";
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
                <p
                  style={{
                    margin: "6px 0 0",
                    fontSize: 12,
                    color: "var(--text2)",
                  }}
                >
                  {approval.instrumentDisplayName}
                </p>
              ) : null}
              <p
                style={{
                  margin: "6px 0 0",
                  fontSize: 12,
                  color: "var(--text3)",
                }}
              >
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
          <p
            style={{ margin: "12px 0 0", fontSize: 12, color: "var(--text2)" }}
          >
            Session:{" "}
            <strong style={{ color: "var(--text1)" }}>
              {approval.sessionName}
            </strong>
          </p>
        )}

        {renderSessionHorizon(summary.sessionHorizon)}

        <div
          style={{
            marginTop: 16,
            padding: 12,
            borderRadius: 10,
            background: "var(--surface2)",
            border: "1px solid var(--border)",
          }}
        >
          <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 6 }}>
            Decision snapshot
          </div>
          {typeof summary.reasoning === "string" && (
            <p
              style={{
                margin: 0,
                fontSize: 13,
                color: "var(--text2)",
                lineHeight: 1.5,
              }}
            >
              {summary.reasoning}
            </p>
          )}
          {typeof summary.riskNote === "string" && summary.riskNote && (
            <p
              style={{
                margin: "10px 0 0",
                fontSize: 12,
                color: "var(--text3)",
              }}
            >
              Risk: {String(summary.riskNote)}
            </p>
          )}
        </div>

        {showRecheckNote && (
          <p
            style={{
              marginTop: 14,
              fontSize: 12,
              color: "#fbbf24",
              lineHeight: 1.45,
            }}
          >
            If this approval was created before the current session run,
            approving will re-run decision and risk checks before any order is
            sent.
          </p>
        )}

        <label
          style={{
            display: "block",
            marginTop: 14,
            fontSize: 12,
            color: "var(--text3)",
          }}
        >
          Note (optional)
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={2}
            className="mt-1 block w-full resize-y rounded-lg border border-border bg-[var(--surface)] p-2 text-[13px] text-[var(--text1)]"
          />
        </label>

        {error && (
          <p style={{ marginTop: 10, fontSize: 12, color: "#f87171" }}>
            {error}
          </p>
        )}

        <div
          style={{
            display: "flex",
            gap: 10,
            marginTop: 18,
            justifyContent: "flex-end",
          }}
        >
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
            className="border-red-400/60 text-red-400 hover:bg-red-500/10 hover:text-red-300"
            onClick={() => void run("rejected")}
            disabled={busy != null || approval.status !== "pending"}
          >
            {busy === "reject" ? "…" : "Reject"}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="border-emerald-400/60 text-emerald-400 hover:bg-emerald-500/10 hover:text-emerald-300"
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

function renderSessionHorizon(value: unknown): ReactNode {
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
    <div
      style={{
        marginTop: 4,
        padding: 12,
        borderRadius: 10,
        background: "rgba(96,165,250,0.08)",
        border: "1px solid rgba(96,165,250,0.22)",
      }}
    >
      <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 8 }}>
        Session trading horizon
      </div>
      <ul
        style={{
          margin: 0,
          paddingLeft: 18,
          fontSize: 12,
          color: "var(--text2)",
          lineHeight: 1.55,
        }}
      >
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
