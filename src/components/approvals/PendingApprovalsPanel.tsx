import { useState } from "react";
import { Badge, Card, SectionTitle } from "@/components/custom-ui";
import { Button } from "@/components/ui";
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
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginBottom: 4,
          }}
        >
          <SectionTitle>Pending approvals</SectionTitle>
          <Badge variant="warn" size="sm">
            {pending.length}
          </Badge>
        </div>
        {pending.length === 0 ? (
          <p style={{ color: "var(--text3)", fontSize: 13, marginTop: 10 }}>
            No pending approvals.
          </p>
        ) : (
          <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
            {pending.map((a) => (
              <Button
                key={a.id}
                type="button"
                onClick={() => setSelected(a)}
                variant="outline"
                className="h-auto w-full justify-between gap-3 rounded-[10px] border-border bg-[var(--surface2)] p-[10px_12px] text-left"
              >
                <div style={{ textAlign: "left" }}>
                  {workspaceViewMode === "global" && (
                    <div
                      style={{
                        fontSize: 12,
                        color: "var(--text3)",
                        marginBottom: 4,
                      }}
                    >
                      {a.sessionName}
                    </div>
                  )}
                  <div
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontWeight: 700,
                      color: "var(--text1)",
                    }}
                  >
                    {a.instrumentSymbol}
                  </div>
                  {a.instrumentDisplayName ? (
                    <div
                      style={{
                        fontSize: 12,
                        color: "var(--text3)",
                        marginTop: 2,
                      }}
                    >
                      {a.instrumentDisplayName}
                    </div>
                  ) : null}
                  <div
                    style={{
                      fontSize: 12,
                      color: "var(--text3)",
                      marginTop: 4,
                    }}
                  >
                    {a.predictionOutcome ? `${a.predictionOutcome} · ` : ""}
                    {a.proposedSide} · {fmt.usd(a.proposedSizeUsd, 0)}
                    {a.confidenceScore != null && (
                      <> · {Math.round(a.confidenceScore * 100)}% conf</>
                    )}
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: "var(--text3)",
                      marginTop: 4,
                    }}
                  >
                    {fmt.time(a.requestedAt)}
                  </div>
                </div>
                <Badge variant="warn" size="sm">
                  pending
                </Badge>
              </Button>
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
