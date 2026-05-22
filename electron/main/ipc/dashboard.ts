import { ipcMain } from "electron";
import { channels } from "@electron/shared/ipc/channels";
import { sessionMatchesEnvironment } from "@electron/shared/domain/environment-mode";
import type { AppServices } from "../services/app-services";
import { resolveExecutionModeFilter } from "../services/workspace/environment-scope";
import { handle } from "./handle";

function resolveCostBreakdownDateRange(payload: unknown): "today" | "all" {
  if (!payload || typeof payload !== "object") return "today";
  const dateRange =
    "dateRange" in payload
      ? (payload as { dateRange?: unknown }).dateRange
      : undefined;
  return dateRange === "all" ? "all" : "today";
}

function sessionsInWorkspaceEnvironment(services: AppServices) {
  const prefs = services.repos.workspacePreferences.get();
  const executionMode = resolveExecutionModeFilter(prefs, {});
  return services.repos.session.list({
    includeArchived: false,
    executionMode,
  });
}

function aggregateApiBudgetUsd(services: AppServices): number {
  let sum = 0;
  for (const s of sessionsInWorkspaceEnvironment(services)) {
    sum += services.strategyContext.get(s.id).riskConfig.maxAiSpendUsd;
  }
  return sum;
}

function aggregateUptimeMin(services: AppServices): number {
  let total = 0;
  for (const s of sessionsInWorkspaceEnvironment(services).filter((session) =>
    ["active", "paused"].includes(session.status),
  )) {
    total += services.session.uptimeMin(s.id);
  }
  return total;
}

export function registerDashboardHandlers(services: AppServices): void {
  handle(ipcMain, channels.dashboard.getStats, async () => {
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
    const sessionId = focusedInEnv?.id ?? null;

    const apiBudget = focusedInEnv
      ? services.strategyContext.get(focusedInEnv.id).riskConfig.maxAiSpendUsd
      : aggregateApiBudgetUsd(services);

    const uptimeMin = focusedInEnv
      ? services.session.uptimeMin(focusedInEnv.id)
      : aggregateUptimeMin(services);

    const sessionStatus = focusedInEnv?.status ?? "idle";

    const portfolio = await services.session.getPortfolioValue(
      sessionId ?? undefined,
    );
    const envSessionIds = sessionId
      ? undefined
      : sessionsInWorkspaceEnvironment(services).map((session) => session.id);
    const stats = services.repos.stats.dashboardStats(
      sessionId,
      sessionStatus,
      portfolio.value,
      uptimeMin,
      apiBudget,
      envSessionIds,
    );
    return {
      ...stats,
      portfolio_value_source: portfolio.source,
      portfolio_broker_count: portfolio.brokerCount,
    };
  });

  handle(ipcMain, channels.dashboard.getCostBreakdown, async (payload) => {
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
    const envSessionIds = focusedInEnv
      ? undefined
      : sessionsInWorkspaceEnvironment(services).map((session) => session.id);
    return services.repos.stats.costBreakdown({
      sessionId: focusedInEnv?.id ?? null,
      sessionIds: envSessionIds,
      dateRange: resolveCostBreakdownDateRange(payload),
    });
  });
}
