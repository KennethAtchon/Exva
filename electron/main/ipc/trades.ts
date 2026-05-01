import { ipcMain } from "electron";
import { approveTradeSchema, tradeIdSchema } from "@/lib/schemas";
import { channels } from "@electron/shared/channels";
import type { AppServices } from "../services/app-services";
import { handle } from "./handle";

export function registerTradeHandlers(services: AppServices): void {
  handle(ipcMain, channels.trades.listActive, async () => {
    return services.repos.trades.listAll(services.repos.session.getFocused()?.id);
  });

  handle(ipcMain, channels.trades.getDetail, async (payload) => {
    const { tradeId } = tradeIdSchema.parse(payload);
    return {
      trade: services.repos.trades.require(tradeId),
      runs: services.repos.agentRuns.listByTrade(tradeId),
    };
  });

  handle(ipcMain, channels.trades.forceClose, async (payload) => {
    const { tradeId } = tradeIdSchema.parse(payload);
    const trade = services.repos.trades.require(tradeId);
    let pnl = 0;
    if (trade.broker_order_id) {
      const result = await services.broker.closeOrder(trade.broker_order_id);
      pnl = result.realizedPnlUsd;
    }
    const closed = services.repos.trades.updateStatus(tradeId, "closed", pnl);
    services.eventBus.emit("trade_closed", closed);
  });

  handle(ipcMain, channels.trades.approve, async (payload) => {
    const { tradeId, approved } = approveTradeSchema.parse(payload);
    const trade = services.repos.trades.require(tradeId);
    if (trade.sessionId) {
      services.runtimeManager.get(trade.sessionId)?.orchestrator.resolveApproval(tradeId, approved);
    }
  });
}
