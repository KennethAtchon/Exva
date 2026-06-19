import { toLegacySessionConfig } from "@electron/shared/domain";
import { ipcMain } from "electron";
import { sessionConfigSchema } from "@/lib/schemas";
import { channels } from "@electron/shared/ipc/channels";
import type { AppServices } from "../../services/app-services";
import { assertFocusedSessionMatchesWorkspace } from "../environment-guards";
import { handle } from "../handle";

export function registerConfigHandlers(services: AppServices): void {
  handle(ipcMain, channels.config.getStrategy, async () => {
    const sessionId = assertFocusedSessionMatchesWorkspace(services);
    return toLegacySessionConfig(services.strategyContext.get(sessionId));
  });

  handle(ipcMain, channels.config.saveStrategy, async (payload) => {
    const cfg = sessionConfigSchema.parse(payload);
    const sessionId = assertFocusedSessionMatchesWorkspace(services);
    services.strategyContext.saveRiskConfig(sessionId, {
      maxPositionUsd: cfg.max_position_usd,
      stopLossPct: cfg.stop_loss_pct,
      takeProfitPct: cfg.take_profit_pct,
      maxConcurrentTrades: cfg.max_concurrent_trades,
      dailyLossLimitUsd: cfg.daily_loss_limit_usd,
      profitTargetUsd: cfg.profit_target_usd,
      maxAiSpendUsd: cfg.max_api_spend_usd,
      humanApprovalRequired: cfg.human_approval_required,
      offHoursTrading: cfg.off_hours_trading,
    });
  });
}
