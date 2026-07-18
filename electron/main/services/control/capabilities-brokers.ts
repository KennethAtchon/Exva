import { z } from "zod";
import type { InstrumentClass } from "@electron/shared/domain/enums";
import type { BrokerRoutingDefault } from "@electron/shared/domain/workspace";
import { AppError } from "@electron/shared/infra/errors";
import { defineCapability } from "./capability";
import { CONFIRM_CLASS, emptyInputSchema } from "./capabilities-shared";

export const refreshBrokerBalance = defineCapability<{
  brokerAccountId: string;
}>({
  key: "refresh_broker_balance",
  label: "Refresh broker balance",
  kind: "mutating",
  confirmClass: CONFIRM_CLASS.brokerOps,
  description:
    "Refresh a broker account balance from the broker API (hits the network).",
  inputSchema: z.object({ brokerAccountId: z.string().min(1) }),
  describe: (input) => `Refresh balance for broker ${input.brokerAccountId}.`,
  affectedEntity: (input) => `broker:${input.brokerAccountId}`,
  execute: async (input, services) => {
    const cachedAt = new Date().toISOString();
    const balanceUsd = await services.brokerBalanceCache.refreshBalance(
      input.brokerAccountId,
    );
    services.eventBus.emit("broker_balance_updated", {
      brokerAccountId: input.brokerAccountId,
      balanceUsd,
      cachedAt,
    });
    return { brokerAccountId: input.brokerAccountId, balanceUsd, cachedAt };
  },
});

export const resetPaperBalance = defineCapability<{
  brokerAccountId: string;
  startingBalanceUsd?: number;
}>({
  key: "reset_paper_balance",
  label: "Reset paper balance",
  kind: "mutating",
  confirmClass: CONFIRM_CLASS.brokerOps,
  description:
    "Reset a paper broker account's starting balance. Live accounts are rejected.",
  inputSchema: z.object({
    brokerAccountId: z.string().min(1),
    startingBalanceUsd: z.number().positive().max(10_000_000).optional(),
  }),
  describe: (input) =>
    `Reset paper balance for ${input.brokerAccountId}${input.startingBalanceUsd != null ? ` to $${input.startingBalanceUsd}` : ""}.`,
  affectedEntity: (input) => `broker:${input.brokerAccountId}`,
  execute: (input, services) => {
    const account = services.repos.brokerAccounts.require(
      input.brokerAccountId,
    );
    if (account.mode !== "paper") {
      throw new AppError(
        "Paper balance reset is only available for paper accounts",
        "VALIDATION_FAILED",
      );
    }
    const row = services.repos.paperBalances.reset(
      input.brokerAccountId,
      input.startingBalanceUsd,
    );
    services.brokerRegistry.invalidate(input.brokerAccountId);
    const cachedAt = new Date().toISOString();
    services.repos.brokerAccounts.updateBalanceCache(
      input.brokerAccountId,
      row.balance,
      cachedAt,
    );
    services.eventBus.emit("broker_balance_updated", {
      brokerAccountId: input.brokerAccountId,
      balanceUsd: row.balance,
      cachedAt,
    });
    return {
      brokerAccountId: input.brokerAccountId,
      balanceUsd: row.balance,
      startingBalanceUsd: row.startingBalance,
      cachedAt,
    };
  },
});

export const getBrokerRouting = defineCapability<Record<string, never>>({
  key: "get_broker_routing",
  label: "Get broker routing",
  kind: "read",
  description:
    "Read global default broker routing by instrument class. Credential entry stays in Settings UI.",
  inputSchema: emptyInputSchema,
  describe: () => "Read global broker routing defaults.",
  execute: (_input, services) => ({
    routing: services.repos.brokerRouting.listGlobalDefaults().map((r) => ({
      instrumentClass: r.instrumentClass,
      defaultBrokerAccountId: r.defaultBrokerAccountId,
    })),
  }),
});

export const updateBrokerRouting = defineCapability<{
  routing: Array<{
    instrumentClass: string;
    defaultBrokerAccountId: string;
  }>;
}>({
  key: "update_broker_routing",
  label: "Update broker routing",
  kind: "mutating",
  confirmClass: CONFIRM_CLASS.brokerOps,
  description:
    "Update global default broker routing by instrument class. Does not add/remove brokers or credentials.",
  inputSchema: z.object({
    routing: z
      .array(
        z.object({
          instrumentClass: z.string().min(1),
          defaultBrokerAccountId: z.string().min(1),
        }),
      )
      .min(1),
  }),
  describe: (input) =>
    `Update broker routing for ${input.routing.map((r) => r.instrumentClass).join(", ")}.`,
  execute: (input, services) => {
    const prefs = services.repos.workspacePreferences.get();
    const requiredMode = prefs.globalEnvironmentMode;
    for (const row of input.routing) {
      const broker = services.repos.brokerAccounts.find(
        row.defaultBrokerAccountId,
      );
      if (!broker) {
        throw new AppError(
          `Broker ${row.defaultBrokerAccountId} was not found.`,
          "NOT_FOUND",
        );
      }
      if (broker.mode !== requiredMode) {
        throw new AppError(
          `Routing default for ${row.instrumentClass} must use a ${requiredMode} broker.`,
          "VALIDATION_FAILED",
        );
      }
    }
    const routing: BrokerRoutingDefault[] = input.routing.map((row) => ({
      instrumentClass: row.instrumentClass as InstrumentClass,
      defaultBrokerAccountId: row.defaultBrokerAccountId,
    }));
    services.repos.brokerRouting.upsertGlobalDefaults(routing);
    return { savedAt: new Date().toISOString() };
  },
});
