import { ipcMain } from "electron";
import { channels } from "@electron/shared/channels";
import type { AppServices } from "../services/app-services";
import { handle } from "./handle";

export function registerDashboardHandlers(services: AppServices): void {
  handle(ipcMain, channels.dashboard.getStats, async () => {
    const sessionId = services.repos.session.getFocusedSessionId();
    const config = services.repos.session.getConfig();
    return services.repos.stats.dashboardStats(
      sessionId,
      services.session.getStatus(),
      services.session.getPortfolioValue(),
      services.session.uptimeMin(),
      config.max_api_spend_usd,
    );
  });

  handle(ipcMain, channels.dashboard.getCostBreakdown, async () => {
    return services.repos.stats.costBreakdown();
  });
}
