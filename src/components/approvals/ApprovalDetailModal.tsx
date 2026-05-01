import { useState, type CSSProperties } from "react";
import { Badge } from "@/components/atoms";
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

export const ApprovalDetailModal = ({ approval, workspaceViewMode, onClose, onDecide }: Props) => {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!approval) return null;

  let summary: Record<string, unknown> = {};
  try {
    summary = JSON.parse(approval.decisionSummaryJson) as Record<string, unknown>;
  } catch {
    summary = {};
  }

  const showRecheckNote = approval.status === "pending";

  const run = async (decision: "approved" | "rejected") => {
    setBusy(decision === "approved" ? "approve" : "reject");
    setError(null);
    try {
      await onDecide({ id: approval.id, decision, decisionNote: note.trim() || undefined });
      setNote("");
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div style={overlay} onClick={onClose} role="presentation">
      <div
        style={panel}
        onClick={(ev) => ev.stopPropagation()}
        role="dialog"
        aria-labelledby="approval-detail-title"
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <div>
            <h2 id="approval-detail-title" style={{ margin: 0, fontSize: 18, color: "var(--text1)" }}>
              {approval.instrumentSymbol}
            </h2>
            <p style={{ margin: "6px 0 0", fontSize: 12, color: "var(--text3)" }}>
              {approval.proposedSide} · {fmt.usd(approval.proposedSizeUsd, 0)} · {approval.brokerName}
            </p>
          </div>
          <Badge variant={approval.status === "pending" ? "warn" : "default"} size="sm">{approval.status}</Badge>
        </div>

        {workspaceViewMode === "global" && (
          <p style={{ margin: "12px 0 0", fontSize: 12, color: "var(--text2)" }}>
            Session: <strong style={{ color: "var(--text1)" }}>{approval.sessionName}</strong>
          </p>
        )}

        <div style={{ marginTop: 16, padding: 12, borderRadius: 10, background: "var(--surface2)", border: "1px solid var(--border)" }}>
          <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 6 }}>Decision snapshot</div>
          {typeof summary.reasoning === "string" && (
            <p style={{ margin: 0, fontSize: 13, color: "var(--text2)", lineHeight: 1.5 }}>{summary.reasoning}</p>
          )}
          {typeof summary.riskNote === "string" && summary.riskNote && (
            <p style={{ margin: "10px 0 0", fontSize: 12, color: "var(--text3)" }}>Risk: {String(summary.riskNote)}</p>
          )}
        </div>

        {showRecheckNote && (
          <p style={{ marginTop: 14, fontSize: 12, color: "#fbbf24", lineHeight: 1.45 }}>
            If this approval was created before the current session run, approving will re-run decision and risk checks
            before any order is sent.
          </p>
        )}

        <label style={{ display: "block", marginTop: 14, fontSize: 12, color: "var(--text3)" }}>
          Note (optional)
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            style={{
              display: "block",
              width: "100%",
              marginTop: 6,
              padding: 8,
              borderRadius: 8,
              border: "1px solid var(--border)",
              background: "var(--surface)",
              color: "var(--text1)",
              fontFamily: "inherit",
              fontSize: 13,
              resize: "vertical",
            }}
          />
        </label>

        {error && (
          <p style={{ marginTop: 10, fontSize: 12, color: "#f87171" }}>{error}</p>
        )}

        <div style={{ display: "flex", gap: 10, marginTop: 18, justifyContent: "flex-end" }}>
          <button type="button" style={btnGhost} onClick={onClose} disabled={busy != null}>
            Cancel
          </button>
          <button
            type="button"
            style={{ ...btn, borderColor: "#f87171", color: "#f87171" }}
            onClick={() => void run("rejected")}
            disabled={busy != null || approval.status !== "pending"}
          >
            {busy === "reject" ? "…" : "Reject"}
          </button>
          <button
            type="button"
            style={{ ...btn, borderColor: "#34d399", color: "#34d399" }}
            onClick={() => void run("approved")}
            disabled={busy != null || approval.status !== "pending"}
          >
            {busy === "approve" ? "…" : "Approve"}
          </button>
        </div>
      </div>
    </div>
  );
};

const overlay: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.55)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 1000,
  padding: 24,
};

const panel: CSSProperties = {
  width: "min(480px, 100%)",
  maxHeight: "90vh",
  overflowY: "auto",
  background: "var(--surface)",
  borderRadius: 14,
  border: "1px solid var(--border)",
  padding: "22px 24px",
  boxShadow: "0 16px 48px rgba(0,0,0,0.35)",
};

const btn: CSSProperties = {
  padding: "8px 16px",
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "transparent",
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 600,
};

const btnGhost: CSSProperties = {
  ...btn,
  borderColor: "var(--border)",
  color: "var(--text2)",
};
