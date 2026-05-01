import { ipcMain } from "electron";
import { channels } from "@electron/shared/channels";
import type { AppServices } from "../services/app-services";
import { handle } from "./handle";

export function registerDashboardHandlers(services: AppServices): void {
  handle(ipcMain, channels.dashboard.getStats, async () => {
    const focused = services.repos.session.getFocused();
    const sessionId = focused?.id ?? null;
    // TODO(phase-04): Replace this fallback budget with workspace/session-aware aggregate stats
    // once dashboard queries have explicit session/global request shapes.
    const config = focused ? services.repos.session.getConfig(focused.id) : { max_api_spend_usd: 5 };
    return services.repos.stats.dashboardStats(
      sessionId,
      focused?.status ?? "idle",
      services.session.getPortfolioValue(),
      focused ? services.session.uptimeMin(focused.id) : 0,
      config.max_api_spend_usd,
    );
  });

  handle(ipcMain, channels.dashboard.getCostBreakdown, async () => {
    return services.repos.stats.costBreakdown();
  });
}
