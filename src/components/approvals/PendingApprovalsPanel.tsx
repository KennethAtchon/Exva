import { useState } from "react";
import { Badge, SectionTitle } from "@/components/custom-ui";
import { Button, Card, HelpTooltip } from "@/components/ui";
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
      <Card className="rounded-[14px] border border-border bg-card px-[22px] py-[18px]">
        <div className="mb-1 flex items-center gap-2.5">
          <SectionTitle>Pending approvals</SectionTitle>
          <HelpTooltip glossaryId="approval-queue" />
          <Badge variant="warn" size="sm">
            {pending.length}
          </Badge>
        </div>
        {pending.length === 0 ? (
          <p className="mt-2.5 text-body text-text3">No pending approvals.</p>
        ) : (
          <div className="mt-3 grid gap-2.5">
            {pending.map((a) => (
              <Button
                key={a.id}
                type="button"
                onClick={() => setSelected(a)}
                variant="outline"
                className="h-auto w-full justify-between gap-3 rounded-sm border-border bg-surface2 p-[10px_12px] text-left"
              >
                <div className="text-left">
                  {workspaceViewMode === "global" && (
                    <div className="mb-1 text-caption text-text3">
                      {a.sessionName}
                    </div>
                  )}
                  <div className="font-mono font-bold text-text1">
                    {a.instrumentSymbol}
                  </div>
                  {a.instrumentDisplayName ? (
                    <div className="mt-0.5 text-caption text-text3">
                      {a.instrumentDisplayName}
                    </div>
                  ) : null}
                  <div className="mt-1 text-caption text-text3">
                    {a.predictionOutcome ? `${a.predictionOutcome} · ` : ""}
                    {a.proposedSide} · {fmt.usd(a.proposedSizeUsd, 0)}
                    {a.confidenceScore != null && (
                      <>
                        {" "}
                        · {Math.round(a.confidenceScore * 100)}% conf
                        <HelpTooltip glossaryId="confidence" />
                      </>
                    )}
                  </div>
                  <div className="mt-1 text-caption text-text3">
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
