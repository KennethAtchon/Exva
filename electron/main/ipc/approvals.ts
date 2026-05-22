import { ipcMain } from "electron";
import { AppError } from "@electron/shared/infra/errors";
import { channels } from "@electron/shared/ipc/channels";
import { approvalDecideSchema, approvalListFiltersSchema } from "@/lib/schemas";
import type { ApprovalSummary } from "@/lib/types";
import { sessionMatchesEnvironment } from "@electron/shared/domain/environment-mode";
import type { AppServices } from "../services/app-services";
import { resolveExecutionModeFilter } from "../services/workspace/environment-scope";
import { assertSessionInWorkspaceEnvironment } from "./environment-guards";
import { handle } from "./handle";

export async function decideApproval(
  services: AppServices,
  input: {
    approvalId: string;
    decision: "approved" | "rejected";
    decisionNote?: string;
  },
): Promise<{ status: "approved" | "rejected"; resolvedAt: string }> {
  const approval = services.repos.tradeApprovals.require(input.approvalId);
  assertSessionInWorkspaceEnvironment(services, approval.sessionId);
  if (approval.status !== "pending") {
    throw new AppError("Approval is not pending", "VALIDATION_FAILED", {
      id: input.approvalId,
    });
  }

  if (input.decision === "rejected") {
    const resolved = services.repos.tradeApprovals.resolve(
      input.approvalId,
      "rejected",
      input.decisionNote,
    );
    services.repos.capitalReservations.releaseByApproval(input.approvalId);
    const trade = services.repos.trades.require(approval.tradeId);
    if (trade.status === "pending") {
      services.repos.trades.updateStatus(trade.id, "rejected", 0);
    }
    services.eventBus.emit("approval_resolved", {
      approvalId: input.approvalId,
      tradeId: approval.tradeId,
      status: "rejected",
    });
    return {
      status: "rejected",
      resolvedAt: resolved.resolvedAt ?? new Date().toISOString(),
    };
  }

  const runtime = services.runtimeManager.get(approval.sessionId);
  const hadCallback =
    runtime?.orchestrator.hasApprovalCallback(approval.tradeId) ?? false;

  if (!hadCallback && !runtime) {
    throw new AppError(
      "Start the session before completing this approval.",
      "SESSION_NOT_ACTIVE",
      {
        sessionId: approval.sessionId,
      },
    );
  }

  const resolved = services.repos.tradeApprovals.resolve(
    input.approvalId,
    "approved",
    input.decisionNote,
  );

  if (hadCallback && runtime) {
    runtime.orchestrator.resolveApproval(approval.tradeId, true);
  } else {
    await services.runtimeManager.enqueueApprovalRecheck({
      sessionId: approval.sessionId,
      instrumentSymbol: approval.instrumentSymbol,
      instrumentClass: approval.instrumentClass,
      approvalId: approval.id,
    });
  }

  services.eventBus.emit("approval_resolved", {
    approvalId: input.approvalId,
    tradeId: approval.tradeId,
    status: "approved",
  });

  return {
    status: "approved",
    resolvedAt: resolved.resolvedAt ?? new Date().toISOString(),
  };
}

function parseConfidenceFromSummary(json: string): number | undefined {
  try {
    const o = JSON.parse(json) as { confidence?: number };
    return typeof o.confidence === "number" ? o.confidence : undefined;
  } catch {
    return undefined;
  }
}

export function registerApprovalHandlers(services: AppServices): void {
  handle(ipcMain, channels.approvals.list, async (payload) => {
    const filters = approvalListFiltersSchema.parse(payload ?? {});

    const prefs = services.repos.workspacePreferences.get();
    const focused = services.repos.session.getFocused();
    const focusedInEnv =
      focused &&
      sessionMatchesEnvironment(
        focused.executionMode,
        prefs.globalEnvironmentMode,
      )
        ? focused
        : null;
    const workspaceViewMode = focusedInEnv
      ? ("session" as const)
      : ("global" as const);

    const status = filters?.status ?? "pending";

    const excludeArchivedSessions =
      workspaceViewMode === "global" ? !prefs.globalIncludeArchived : true;
    const envExecutionMode = resolveExecutionModeFilter(prefs, {});
    const envSessions = services.repos.session.list({
      includeArchived: !excludeArchivedSessions,
      executionMode: envExecutionMode,
    });
    const envSessionIds = new Set(envSessions.map((session) => session.id));

    const sessionIds =
      workspaceViewMode === "session" && focusedInEnv
        ? [focusedInEnv.id]
        : [...envSessionIds];

    if (sessionIds.length === 0) {
      return { workspaceViewMode, approvals: [] };
    }

    const rows = services.repos.tradeApprovals.listAll({
      status,
      sessionIds,
      excludeArchivedSessions,
    });

    const sessions = envSessions;
    const nameById = new Map(sessions.map((s) => [s.id, s.name]));

    const summaries: ApprovalSummary[] = rows.map((a) => {
      const broker = services.repos.brokerAccounts.find(a.brokerAccountId);
      return {
        ...a,
        sessionName: nameById.get(a.sessionId) ?? a.sessionId,
        brokerName: broker?.name ?? "—",
        confidenceScore: parseConfidenceFromSummary(a.decisionSummaryJson),
      };
    });

    return { workspaceViewMode, approvals: summaries };
  });

  handle(ipcMain, channels.approvals.decide, async (payload) => {
    const body = approvalDecideSchema.parse(payload);
    return decideApproval(services, {
      approvalId: body.id,
      decision: body.decision,
      decisionNote: body.decisionNote,
    });
  });
}
