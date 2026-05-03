import { useState, type CSSProperties } from "react";
import { Badge, Card, SectionTitle } from "@/components/custom-ui";
import { fmt } from "@/lib/formatters";
import type { ApprovalSummary } from "@/lib/types";
import { ApprovalDetailModal } from "./ApprovalDetailModal";

type Props = {
  approvals: ApprovalSummary[];
  workspaceViewMode: "session" | "global";
  onRefresh: () => void;
  onDecide: (input: {
    id: string;
    decision: "approved" | "rejected";
    decisionNote?: string;
  }) => Promise<{ status: "approved" | "rejected"; resolvedAt: string }>;
};

export const PendingApprovalsPanel = ({
  approvals,
  workspaceViewMode,
  onRefresh,
  onDecide,
}: Props) => {
  const [selected, setSelected] = useState<ApprovalSummary | null>(null);

  const pending = approvals.filter((a) => a.status === "pending");

  return (
    <>
      <Card style={{ padding: "18px 22px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
          <SectionTitle>Pending approvals</SectionTitle>
          <Badge variant="warn" size="sm">{pending.length}</Badge>
        </div>
        {pending.length === 0 ? (
          <p style={{ color: "var(--text3)", fontSize: 13, marginTop: 10 }}>No pending approvals.</p>
        ) : (
          <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
            {pending.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => setSelected(a)}
                style={row}
              >
                <div style={{ textAlign: "left" }}>
                  {workspaceViewMode === "global" && (
                    <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 4 }}>{a.sessionName}</div>
                  )}
                  <div style={{ fontFamily: "var(--font-mono)", fontWeight: 700, color: "var(--text1)" }}>
                    {a.instrumentSymbol}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 4 }}>
                    {a.proposedSide} · {fmt.usd(a.proposedSizeUsd, 0)}
                    {a.confidenceScore != null && (
                      <> · {Math.round(a.confidenceScore * 100)}% conf</>
                    )}
                  </div>
                  <div style={{ fontSize: 10, color: "var(--text3)", marginTop: 4 }}>{fmt.time(a.requestedAt)}</div>
                </div>
                <Badge variant="warn" size="sm">pending</Badge>
              </button>
            ))}
          </div>
        )}
      </Card>

      <ApprovalDetailModal
        approval={selected}
        workspaceViewMode={workspaceViewMode}
        onClose={() => {
          setSelected(null);
          onRefresh();
        }}
        onDecide={onDecide}
      />
    </>
  );
};

const row: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12,
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid var(--border)",
  background: "var(--surface2)",
  cursor: "pointer",
  width: "100%",
  textAlign: "left",
  font: "inherit",
};
