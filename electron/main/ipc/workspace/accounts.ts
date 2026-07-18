import { ipcMain } from "electron";
import { z } from "zod";
import {
  apiKeySchema,
  brokerAccountAddSchema,
  brokerAccountIdSchema,
  brokerRoutingUpdateSchema,
  brokerTestEphemeralSchema,
  providerAccountSaveSchema,
  providerAccountDeleteSchema,
  providerAccountTestSchema,
} from "@/lib/schemas";
import { channels } from "@electron/shared/ipc/channels";
import { AppError } from "@electron/shared/infra/errors";
import { isBuiltInSearchProviderAccount } from "@electron/shared/instruments/search-providers";
import type { AppServices } from "../../services/app-services";
import { resolveBrokerModeFilter } from "../../services/session/environment-scope";
import { assertBrokerModeMatchesWorkspace } from "../environment-guards";
import {
  serializeBrokerCredentials,
  tempBrokerAccount,
} from "../trading/broker-account-helpers";
import { secretKeys } from "../../services/infra/secrets-service";
import { handle } from "../handle";
import {
  ipcNoPayloadSchema,
  ipcPayloadUnknownSchema,
} from "../payload-schemas";

export function registerAccountHandlers(services: AppServices): void {
  handle(
    ipcMain,
    channels.accounts.saveApiKey,
    ipcPayloadUnknownSchema,
    async (payload) => {
      const { keyType, value } = apiKeySchema.parse(payload);
      const keyByType = {
        anthropic: secretKeys.anthropic,
        brave: secretKeys.brave,
        tavily: secretKeys.tavily,
      };
      await services.secrets.set(keyByType[keyType], value);
    },
  );

  handle(
    ipcMain,
    channels.accounts.listProviders,
    ipcNoPayloadSchema,
    async () => {
      return { providers: services.repos.providerAccounts.list() };
    },
  );

  handle(
    ipcMain,
    channels.accounts.saveProvider,
    ipcPayloadUnknownSchema,
    async (payload) => {
      const input = providerAccountSaveSchema.parse(payload);
      const id = input.id ?? crypto.randomUUID();
      const existing = input.id
        ? services.repos.providerAccounts.find(input.id)
        : null;
      if (existing && isBuiltInSearchProviderAccount(existing)) {
        throw new AppError(
          "Built-in search providers cannot be edited.",
          "VALIDATION_FAILED",
          { id: existing.id },
        );
      }
      const secretRef = `provider:${id}`;
      await services.secrets.set(secretRef, input.apiKey);
      services.repos.providerAccounts.upsert({
        id,
        name: input.name,
        category: input.category,
        providerType: input.providerType,
        secretRef,
        metadataJson: input.metadata ? JSON.stringify(input.metadata) : null,
        isConfigured: true,
      });
      services.providerRegistry.invalidate(id);
      services.searchRegistry.invalidate(id);
      return { id, isConfigured: true };
    },
  );

  handle(
    ipcMain,
    channels.accounts.deleteProvider,
    ipcPayloadUnknownSchema,
    async (payload) => {
      const { id } = providerAccountDeleteSchema.parse(payload);
      const account = services.repos.providerAccounts.find(id);
      if (!account)
        throw new AppError(`Provider ${id} was not found`, "NOT_FOUND", { id });
      if (isBuiltInSearchProviderAccount(account)) {
        throw new AppError(
          "Built-in search providers cannot be deleted.",
          "VALIDATION_FAILED",
          { id },
        );
      }
      await services.secrets.delete(account.secretRef);
      services.repos.providerAccounts.delete(id);
      services.providerRegistry.invalidate(id);
      services.searchRegistry.invalidate(id);
      return { ok: true as const };
    },
  );

  handle(
    ipcMain,
    channels.accounts.testProvider,
    ipcPayloadUnknownSchema,
    async (payload) => {
      const { id } = providerAccountTestSchema.parse(payload);
      const account = services.repos.providerAccounts.find(id);
      if (!account)
        throw new AppError(`Provider ${id} was not found`, "NOT_FOUND", { id });

      const result =
        account.category === "search"
          ? await (await services.searchRegistry.get(id)).testConnection()
          : await (await services.providerRegistry.get(id)).testConnection();

      services.repos.providerAccounts.setLastTestStatus(
        id,
        result.ok ? "ok" : "error",
      );
      return result;
    },
  );

  handle(
    ipcMain,
    channels.accounts.listBrokers,
    ipcPayloadUnknownSchema,
    async (payload) => {
      const parsed = z
        .object({ includeAllEnvironments: z.boolean().optional() })
        .optional()
        .parse(payload);
      const includeAllEnvironments = parsed?.includeAllEnvironments === true;
      const prefs = services.repos.workspacePreferences.get();
      const mode = resolveBrokerModeFilter(prefs, { includeAllEnvironments });
      const brokers = services.repos.brokerAccounts
        .list()
        .filter((broker) => !mode || broker.mode === mode);
      return { brokers };
    },
  );

  handle(
    ipcMain,
    channels.accounts.addBroker,
    ipcPayloadUnknownSchema,
    async (payload) => {
      const input = brokerAccountAddSchema.parse(payload);
      assertBrokerModeMatchesWorkspace(services, input.mode);
      const id = input.id ?? crypto.randomUUID();
      const secretRef = `broker:${id}`;
      const json = serializeBrokerCredentials(
        input.brokerType,
        input.mode,
        input.credentials,
      );
      const temp = tempBrokerAccount(id, {
        name: input.name,
        brokerType: input.brokerType,
        mode: input.mode,
        mockScenarioKind: input.mockScenarioKind ?? null,
      });
      const adapter = await services.brokerRegistry.buildEphemeral(temp, json);
      const test = await adapter.testConnection();
      if (!test.ok) {
        return {
          ok: false as const,
          id,
          message: test.message,
          supportedInstrumentClasses: temp.supportedInstrumentClasses,
        };
      }
      const balance = await adapter.getAccountBalance();
      const balanceCachedAt = new Date().toISOString();

      await services.secrets.set(secretRef, json);
      services.repos.brokerAccounts.insert({
        id,
        name: input.name,
        brokerType: input.brokerType,
        supportedInstrumentClasses: temp.supportedInstrumentClasses,
        mode: input.mode,
        secretRef,
        mockScenarioKind:
          input.brokerType === "mock"
            ? (input.mockScenarioKind ?? "clean_breakout")
            : null,
        mockExecutionTier:
          input.brokerType === "mock"
            ? (input.mockExecutionTier ?? "scripted")
            : null,
      });
      services.repos.brokerAccounts.updateBalanceCache(
        id,
        balance,
        balanceCachedAt,
      );
      services.brokerRegistry.invalidate(id);
      return {
        ok: true as const,
        id,
        supportedInstrumentClasses: temp.supportedInstrumentClasses,
      };
    },
  );

  handle(
    ipcMain,
    channels.accounts.removeBrokerAccount,
    ipcPayloadUnknownSchema,
    async (payload) => {
      const { id } = brokerAccountIdSchema.parse(payload);
      const row = services.repos.brokerAccounts.find(id);
      if (!row)
        throw new AppError(`Broker account ${id} was not found`, "NOT_FOUND", {
          id,
        });
      await services.secrets.delete(row.secretRef);
      services.repos.brokerAccounts.delete(id);
      services.brokerRegistry.invalidate(id);
      return { ok: true as const };
    },
  );

  handle(
    ipcMain,
    channels.accounts.testBrokerAccount,
    ipcPayloadUnknownSchema,
    async (payload) => {
      const { id } = brokerAccountIdSchema.parse(payload);
      const account = services.repos.brokerAccounts.find(id);
      if (!account)
        throw new AppError(`Broker account ${id} was not found`, "NOT_FOUND", {
          id,
        });
      const adapter = await services.brokerRegistry.get(id);
      return adapter.testConnection();
    },
  );

  handle(
    ipcMain,
    channels.accounts.testBrokerEphemeral,
    ipcPayloadUnknownSchema,
    async (payload) => {
      const input = brokerTestEphemeralSchema.parse(payload);
      const id = `ephemeral-${crypto.randomUUID()}`;
      const temp = tempBrokerAccount(id, {
        name: "Ephemeral",
        brokerType: input.brokerType,
        mode: input.mode,
      });
      const json = serializeBrokerCredentials(
        input.brokerType,
        input.mode,
        input.credentials,
      );
      const adapter = await services.brokerRegistry.buildEphemeral(temp, json);
      return adapter.testConnection();
    },
  );

  handle(
    ipcMain,
    channels.accounts.routingGet,
    ipcNoPayloadSchema,
    async () => ({
      routing: services.repos.brokerRouting.listGlobalDefaults(),
    }),
  );

  handle(
    ipcMain,
    channels.accounts.routingUpdate,
    ipcPayloadUnknownSchema,
    async (payload) => {
      const { routing } = brokerRoutingUpdateSchema.parse(payload);
      const prefs = services.repos.workspacePreferences.get();
      const requiredMode = prefs.globalEnvironmentMode;
      for (const row of routing) {
        if (!row.defaultBrokerAccountId) continue;
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
            `Routing default for ${row.instrumentClass} must use a ${requiredMode} broker in the current workspace environment.`,
            "VALIDATION_FAILED",
            {
              instrumentClass: row.instrumentClass,
              brokerMode: broker.mode,
              requiredMode,
            },
          );
        }
      }
      services.repos.brokerRouting.upsertGlobalDefaults(routing);
      return { savedAt: new Date().toISOString() };
    },
  );
}
