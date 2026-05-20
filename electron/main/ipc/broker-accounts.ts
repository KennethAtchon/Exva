import { ipcMain } from "electron";
import { z } from "zod";
import { channels } from "@electron/shared/ipc/channels";
import type { AppServices } from "../services/app-services";
import { handle } from "./handle";

const refreshBalanceSchema = z.object({ brokerAccountId: z.string() });
const updateSettingsSchema = z.object({
  brokerAccountId: z.string(),
  maxSessions: z.number().int().min(1).max(50).optional(),
  allocationEnforcement: z.enum(["hard", "warn"]).optional(),
  balanceRefreshIntervalMin: z.number().int().min(1).max(60).optional(),
});

export function registerBrokerAccountHandlers(services: AppServices): void {
  handle(ipcMain, channels.brokerAccounts.list, async () =>
    services.brokerCapital.listWithState(),
  );

  handle(ipcMain, channels.brokerAccounts.refreshBalance, async (payload) => {
    const { brokerAccountId } = refreshBalanceSchema.parse(payload);
    const cachedAt = new Date().toISOString();
    const balance =
      await services.brokerBalanceCache.refreshBalance(brokerAccountId);
    services.eventBus.emit("broker_balance_updated", {
      brokerAccountId,
      balanceUsd: balance,
      cachedAt,
    });
    return { balanceUsd: balance, cachedAt };
  });

  handle(ipcMain, channels.brokerAccounts.updateSettings, async (payload) => {
    const { brokerAccountId, ...patch } = updateSettingsSchema.parse(payload);
    services.brokerCapital.updateSettings(brokerAccountId, patch);
    return { ok: true as const };
  });
}
