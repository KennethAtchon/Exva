import { ipcMain } from "electron";
import {
  approveTradeSchema,
  listTradesFiltersSchema,
  tradeIdSchema,
} from "@/lib/schemas";
import { channels } from "@electron/shared/ipc/channels";
import type { AppServices } from "../../services/app-services";
import { resolveExecutionModeFilter } from "../../services/session/environment-scope";
import { assertSessionInWorkspaceEnvironment } from "../environment-guards";
import { decideApproval } from "./approvals";
import { handle } from "../handle";

export function registerTradeHandlers(services: AppServices): void {
  handle(ipcMain, channels.trades.listActive, async (payload) => {
    const filters = listTradesFiltersSchema.parse(payload ?? {});
    const prefs = services.repos.workspacePreferences.get();
    const focused = services.repos.session.getFocused();
    const sessionScope = focused?.id;

    const merged = {
      ...filters,
      sessionId: filters.sessionId ?? sessionScope,
      executionMode: resolveExecutionModeFilter(prefs, filters),
    };

    const trades = services.repos.trades.listAllFiltered({
      sessionId: merged.sessionId,
      brokerAccountId: merged.brokerAccountId,
      symbolContains: merged.symbolContains,
      instrumentType: merged.instrumentType,
      executionMode: merged.executionMode,
    });

    const sessions = services.repos.session.list({ includeArchived: true });
    const nameById = new Map(sessions.map((s) => [s.id, s.name]));

    return trades.map((t) => ({
      ...t,
      sessionName: t.sessionId
        ? (nameById.get(t.sessionId) ?? t.sessionId)
        : undefined,
    }));
  });

  handle(ipcMain, channels.trades.getDetail, async (payload) => {
    const { tradeId } = tradeIdSchema.parse(payload);
    const trade = services.repos.trades.require(tradeId);
    if (trade.sessionId) {
      assertSessionInWorkspaceEnvironment(services, trade.sessionId);
    }
    return {
      trade,
      runs: services.repos.agentRuns.listByTrade(tradeId),
      messages: services.repos.agentMessages.listByTrade(tradeId),
    };
  });

  handle(ipcMain, channels.trades.forceClose, async (payload) => {
    const { tradeId } = tradeIdSchema.parse(payload);
    const trade = services.repos.trades.require(tradeId);
    if (trade.sessionId) {
      assertSessionInWorkspaceEnvironment(services, trade.sessionId);
    }
    let pnl = 0;
    if (trade.broker_order_id && trade.brokerAccountId) {
      const result = await services.broker.closeOrder(
        trade.brokerAccountId,
        trade.broker_order_id,
      );
      pnl = result.realizedPnlUsd;
    }
    const closed = services.repos.trades.updateStatus(tradeId, "closed", pnl);
    services.capitalReservation.releaseOnClose(tradeId);
    services.eventBus.emit("trade_closed", closed);
  });

  handle(ipcMain, channels.trades.approve, async (payload) => {
    const { tradeId, approved } = approveTradeSchema.parse(payload);
    const pending = services.repos.tradeApprovals.findPendingByTradeId(tradeId);
    if (pending) {
      return decideApproval(services, {
        approvalId: pending.id,
        decision: approved ? "approved" : "rejected",
      });
    }
    const trade = services.repos.trades.require(tradeId);
    if (trade.sessionId) {
      services.runtimeManager
        .get(trade.sessionId)
        ?.orchestrator.resolveApproval(tradeId, approved);
    }
  });
}
