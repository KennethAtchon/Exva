import { ipcMain } from "electron";
import { apiKeySchema, brokerCredentialsSchema } from "@/lib/schemas";
import { channels } from "@electron/shared/channels";
import type { AppServices } from "../services/app-services";
import { secretKeys } from "../services/secrets-service";
import { handle } from "./handle";

export function registerAccountHandlers(services: AppServices): void {
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
}
