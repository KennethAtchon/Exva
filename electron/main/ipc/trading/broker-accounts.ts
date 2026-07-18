import { ipcMain } from "electron";
import { z } from "zod";
import { channels } from "@electron/shared/ipc/channels";
import type { AppServices } from "../../services/app-services";
import { resolveBrokerModeFilter } from "../../services/session/environment-scope";
import { handle } from "../handle";

const listBrokerAccountsSchema = z.preprocess(
  (value) => value ?? undefined,
  z.object({ includeAllEnvironments: z.boolean().optional() }).optional(),
);
const refreshBalanceSchema = z.object({ brokerAccountId: z.string() });
const resetPaperBalanceSchema = z.object({
  brokerAccountId: z.string(),
  startingBalanceUsd: z.number().positive().max(10_000_000).optional(),
});
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
  mockExecutionTier: z.enum(["scripted", "rehearsal"]).nullable().optional(),
});

export function registerBrokerAccountHandlers(services: AppServices): void {
  handle(
    ipcMain,
    channels.brokerAccounts.list,
    listBrokerAccountsSchema,
    async (parsed) => {
      const includeAllEnvironments = parsed?.includeAllEnvironments === true;
      const prefs = services.repos.workspacePreferences.get();
      const mode = resolveBrokerModeFilter(prefs, { includeAllEnvironments });
      const rows = services.brokerCapital.listWithState();
      return mode ? rows.filter((broker) => broker.mode === mode) : rows;
    },
  );

  handle(
    ipcMain,
    channels.brokerAccounts.refreshBalance,
    refreshBalanceSchema,
    async ({ brokerAccountId }) => {
      const cachedAt = new Date().toISOString();
      const balance =
        await services.brokerBalanceCache.refreshBalance(brokerAccountId);
      services.eventBus.emit("broker_balance_updated", {
        brokerAccountId,
        balanceUsd: balance,
        cachedAt,
      });
      return { balanceUsd: balance, cachedAt };
    },
  );

  handle(
    ipcMain,
    channels.brokerAccounts.updateSettings,
    updateSettingsSchema,
    async ({ brokerAccountId, ...patch }) => {
      services.brokerCapital.updateSettings(brokerAccountId, patch);
      if (
        patch.mockScenarioKind !== undefined ||
        patch.mockExecutionTier !== undefined
      ) {
        services.brokerRegistry.invalidate(brokerAccountId);
      }
      return { ok: true as const };
    },
  );

  handle(
    ipcMain,
    channels.brokerAccounts.resetPaperBalance,
    resetPaperBalanceSchema,
    async ({ brokerAccountId, startingBalanceUsd }) => {
      const account = services.repos.brokerAccounts.require(brokerAccountId);
      if (account.mode !== "paper") {
        throw new Error(
          "Paper balance reset is only available for paper accounts",
        );
      }
      const row = services.repos.paperBalances.reset(
        brokerAccountId,
        startingBalanceUsd,
      );
      services.brokerRegistry.invalidate(brokerAccountId);
      const cachedAt = new Date().toISOString();
      services.repos.brokerAccounts.updateBalanceCache(
        brokerAccountId,
        row.balance,
        cachedAt,
      );
      services.eventBus.emit("broker_balance_updated", {
        brokerAccountId,
        balanceUsd: row.balance,
        cachedAt,
      });
      return {
        balanceUsd: row.balance,
        startingBalanceUsd: row.startingBalance,
        cachedAt,
      };
    },
  );
}
