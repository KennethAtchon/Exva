import { ipcMain } from "electron";
import { apiKeySchema, brokerCredentialsSchema, providerAccountSaveSchema, providerAccountTestSchema } from "@/lib/schemas";
import { channels } from "@electron/shared/channels";
import { AppError } from "@electron/shared/errors";
import type { AppServices } from "../services/app-services";
import { secretKeys } from "../services/infra/secrets-service";
import { ProviderRegistry } from "../services/ai/provider-registry";
import { SearchRegistry } from "../services/ai/search/search-registry";
import { handle } from "./handle";

export function registerAccountHandlers(services: AppServices): void {
  const providerRegistry = new ProviderRegistry(services.repos.providerAccounts, services.secrets);
  const searchRegistry = new SearchRegistry(services.repos.providerAccounts, services.secrets);

  handle(ipcMain, channels.accounts.saveBroker, async (payload) => {
    const credentials = brokerCredentialsSchema.parse(payload);
    return services.broker.saveBroker(credentials);
  });

  handle(ipcMain, channels.accounts.testBroker, async () => services.broker.testConnection());

  handle(ipcMain, channels.accounts.removeBroker, async () => services.broker.removeBroker());

  handle(ipcMain, channels.accounts.saveApiKey, async (payload) => {
    const { keyType, value } = apiKeySchema.parse(payload);
    const keyByType = {
      anthropic: secretKeys.anthropic,
      brave: secretKeys.brave,
      tavily: secretKeys.tavily,
    };
    await services.secrets.set(keyByType[keyType], value);
  });

  handle(ipcMain, channels.accounts.listProviders, async () => {
    return { providers: services.repos.providerAccounts.list() };
  });

  handle(ipcMain, channels.accounts.saveProvider, async (payload) => {
    const input = providerAccountSaveSchema.parse(payload);
    const id = input.id ?? crypto.randomUUID();
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
    providerRegistry.invalidate(id);
    searchRegistry.invalidate(id);
    return { id, isConfigured: true };
  });

  handle(ipcMain, channels.accounts.testProvider, async (payload) => {
    const { id } = providerAccountTestSchema.parse(payload);
    const account = services.repos.providerAccounts.find(id);
    if (!account) throw new AppError(`Provider ${id} was not found`, "NOT_FOUND", { id });

    const result = account.category === "search"
      ? await (await searchRegistry.get(id)).testConnection()
      : await (await providerRegistry.get(id)).testConnection();

    services.repos.providerAccounts.setLastTestStatus(id, result.ok ? "ok" : "error");
    return result;
  });
}
