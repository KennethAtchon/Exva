import { ipcMain } from "electron";
import { channels } from "@electron/shared/channels";
import type { AppServices } from "../services/app-services";
import { handle } from "./handle";

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

    const uptimeMin = focused ? services.session.uptimeMin(focused.id) : aggregateUptimeMin(services);

    const sessionStatus = focused?.status ?? "idle";

    return services.repos.stats.dashboardStats(
      sessionId,
      sessionStatus,
      services.session.getPortfolioValue(),
      uptimeMin,
      apiBudget,
    );
  });

  handle(ipcMain, channels.dashboard.getCostBreakdown, async () => {
    return services.repos.stats.costBreakdown();
  });
}
