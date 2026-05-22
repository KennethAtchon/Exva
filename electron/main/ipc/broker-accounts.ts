import { ipcMain } from "electron";
import { z } from "zod";
import { channels } from "@electron/shared/ipc/channels";
import type { AppServices } from "../services/app-services";
import { resolveBrokerModeFilter } from "../services/workspace/environment-scope";
import { handle } from "./handle";

const refreshBalanceSchema = z.object({ brokerAccountId: z.string() });
const updateSettingsSchema = z.object({
  brokerAccountId: z.string(),
  maxSessions: z.number().int().min(1).max(50).optional(),
  allocationEnforcement: z.enum(["hard", "warn"]).optional(),
  balanceRefreshIntervalMin: z.number().int().min(1).max(60).optional(),
  mockScenarioKind: z
    .enum([
      "clean_breakout",
      "failed_breakout",
      "sideways_chop",
      "gap_down_after_entry",
      "news_reversal",
      "stale_quote",
      "wide_spread",
      "partial_fill",
      "broker_reject",
      "rate_limit",
    ])
    .nullable()
    .optional(),
});

export function registerBrokerAccountHandlers(services: AppServices): void {
  handle(ipcMain, channels.brokerAccounts.list, async (payload) => {
    const parsed = z
      .object({ includeAllEnvironments: z.boolean().optional() })
      .optional()
      .parse(payload);
    const includeAllEnvironments = parsed?.includeAllEnvironments === true;
    const prefs = services.repos.workspacePreferences.get();
    const mode = resolveBrokerModeFilter(prefs, { includeAllEnvironments });
    const rows = services.brokerCapital.listWithState();
    return mode ? rows.filter((broker) => broker.mode === mode) : rows;
  });

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
    if (patch.mockScenarioKind !== undefined) {
      services.brokerRegistry.invalidate(brokerAccountId);
    }
    return { ok: true as const };
  });
}
