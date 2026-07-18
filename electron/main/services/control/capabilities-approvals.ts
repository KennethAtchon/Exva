import { z } from "zod";
import { decideApproval, listApprovals } from "../../ipc/trading/approvals";
import { defineCapability } from "./capability";
import { CONFIRM_CLASS } from "./capabilities-shared";

export const listPendingApprovals = defineCapability<{
  status?: "pending" | "approved" | "rejected";
}>({
  key: "list_pending_approvals",
  label: "List trade approvals",
  kind: "read",
  description:
    "List trade approvals in the current workspace environment (default: pending). Returns id, session, symbol, side, size, and broker.",
  inputSchema: z.object({
    status: z.enum(["pending", "approved", "rejected"]).optional(),
  }),
  describe: (input) => `List ${input.status ?? "pending"} trade approvals.`,
  execute: (input, services) => {
    const { workspaceViewMode, approvals } = listApprovals(services, {
      status: input.status ?? "pending",
    });
    return {
      workspaceViewMode,
      count: approvals.length,
      approvals: approvals.map((a) => ({
        id: a.id,
        tradeId: a.tradeId,
        sessionId: a.sessionId,
        sessionName: a.sessionName,
        symbol: a.instrumentSymbol,
        side: a.proposedSide,
        notionalUsd: a.proposedSizeUsd,
        brokerAccountId: a.brokerAccountId,
        brokerName: a.brokerName,
        status: a.status,
        confidenceScore: a.confidenceScore ?? null,
        requestedAt: a.requestedAt,
      })),
    };
  },
});

export const decideApprovalCap = defineCapability<{
  approvalId: string;
  decision: "approved" | "rejected";
  decisionNote?: string;
}>({
  key: "decide_approval",
  label: "Decide trade approval",
  kind: "mutating",
  confirmClass: CONFIRM_CLASS.tradeExecution,
  alwaysConfirm: (input) => input.decision === "approved",
  description:
    "Approve or reject a pending trade approval by id (use list_pending_approvals first). Approvals always require confirmation.",
  inputSchema: z.object({
    approvalId: z.string().min(1),
    decision: z.enum(["approved", "rejected"]),
    decisionNote: z.string().max(2000).optional(),
  }),
  describe: (input, services) => {
    try {
      const a = services.repos.tradeApprovals.require(input.approvalId);
      return `${input.decision === "approved" ? "Approve" : "Reject"} ${a.proposedSide} ${a.instrumentSymbol} (~$${Math.round(a.proposedSizeUsd)}).`;
    } catch {
      return `${input.decision === "approved" ? "Approve" : "Reject"} approval ${input.approvalId}.`;
    }
  },
  risk: (input, services) => {
    try {
      const a = services.repos.tradeApprovals.require(input.approvalId);
      const broker = services.repos.brokerAccounts
        .list()
        .find((b) => b.id === a.brokerAccountId);
      return broker?.mode === "live"
        ? {
            level: "live",
            note: "This decides a trade on a LIVE broker account.",
          }
        : null;
    } catch {
      return null;
    }
  },
  affectedEntity: (input) => `approval:${input.approvalId}`,
  execute: (input, services) =>
    decideApproval(services, {
      approvalId: input.approvalId,
      decision: input.decision,
      decisionNote: input.decisionNote,
    }),
});
