import { ipcMain } from "electron";
import { channels } from "@electron/shared/ipc/channels";
import type { AppServices } from "../services/app-services";
import { handle } from "./handle";

function resolveCostBreakdownDateRange(payload: unknown): "today" | "all" {
  if (!payload || typeof payload !== "object") return "today";
  const dateRange =
    "dateRange" in payload
      ? (payload as { dateRange?: unknown }).dateRange
      : undefined;
  return dateRange === "all" ? "all" : "today";
}

function aggregateApiBudgetUsd(services: AppServices): number {
  const sessions = services.repos.session.list({ includeArchived: false });
  let sum = 0;
  for (const s of sessions) {
    if (s.status === "archived") continue;
    sum += services.strategyContext.get(s.id).riskConfig.maxAiSpendUsd;
  }
  return sum;
}

function aggregateUptimeMin(services: AppServices): number {
  let total = 0;
  for (const s of services.repos.session.listByStatuses(["active", "paused"])) {
    total += services.session.uptimeMin(s.id);
  }
  return total;
}

export function registerDashboardHandlers(services: AppServices): void {
  handle(ipcMain, channels.dashboard.getStats, async () => {
    const focused = services.repos.session.getFocused();
    const sessionId = focused?.id ?? null;

    const apiBudget = focused
      ? services.strategyContext.get(focused.id).riskConfig.maxAiSpendUsd
      : aggregateApiBudgetUsd(services);

    const uptimeMin = focused
      ? services.session.uptimeMin(focused.id)
      : aggregateUptimeMin(services);

    const sessionStatus = focused?.status ?? "idle";

    const portfolio = await services.session.getPortfolioValue(
      sessionId ?? undefined,
    );
    const stats = services.repos.stats.dashboardStats(
      sessionId,
      sessionStatus,
      portfolio.value,
      uptimeMin,
      apiBudget,
    );
    return {
      ...stats,
      portfolio_value_source: portfolio.source,
      portfolio_broker_count: portfolio.brokerCount,
    };
  });

  handle(ipcMain, channels.dashboard.getCostBreakdown, async (payload) => {
    const focused = services.repos.session.getFocused();
    return services.repos.stats.costBreakdown({
      sessionId: focused?.id ?? null,
      dateRange: resolveCostBreakdownDateRange(payload),
    });
  });
}
