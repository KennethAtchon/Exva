import { ipcMain } from "electron";
import {
  strategyAiRolesSaveSchema,
  strategyGetProviderModelsSchema,
  strategyProfileSaveSchema,
  strategyResetPromptSchema,
  strategyRiskConfigSaveSchema,
  strategyTimeframeConfigSaveSchema,
} from "@electron/shared/schemas";
import { channels } from "@electron/shared/channels";
import type { AppServices } from "../services/app-services";
import { MODEL_CATALOG } from "../services/ai/provider-model-catalog";
import { handle } from "./handle";

export function registerStrategyHandlers(services: AppServices): void {
  handle(ipcMain, channels.strategy.get, async (payload) => {
    const sessionId = resolveSessionId(services, payload);
    return services.strategyContext.getPageData(sessionId);
  });

  handle(ipcMain, channels.strategy.getProfile, async (payload) => {
    const sessionId = resolveSessionId(services, payload);
    return services.strategyContext.getProfile(sessionId);
  });

  handle(ipcMain, channels.strategy.saveProfile, async (payload) => {
    const input = strategyProfileSaveSchema.parse(payload);
    services.strategyContext.saveProfile(resolveSessionId(services, input), input.profile);
    return { savedAt: new Date().toISOString() };
  });

  handle(ipcMain, channels.strategy.getRiskConfig, async (payload) => {
    const sessionId = resolveSessionId(services, payload);
    return services.strategyContext.getRiskConfig(sessionId);
  });

  handle(ipcMain, channels.strategy.saveRiskConfig, async (payload) => {
    const input = strategyRiskConfigSaveSchema.parse(payload);
    services.strategyContext.saveRiskConfig(resolveSessionId(services, input), input.riskConfig);
    return { savedAt: new Date().toISOString() };
  });

  handle(ipcMain, channels.strategy.getTimeframeConfig, async (payload) => {
    const sessionId = resolveSessionId(services, payload);
    return services.strategyContext.getTimeframeConfig(sessionId);
  });

  handle(ipcMain, channels.strategy.saveTimeframeConfig, async (payload) => {
    const input = strategyTimeframeConfigSaveSchema.parse(payload);
    services.strategyContext.saveTimeframeConfig(resolveSessionId(services, input), input.timeframe);
    return { savedAt: new Date().toISOString() };
  });

  handle(ipcMain, channels.strategy.saveAiRoles, async (payload) => {
    const input = strategyAiRolesSaveSchema.parse(payload);
    const sessionId = resolveSessionId(services, input);
    services.strategyContext.saveAiRoles(
      sessionId,
      input.aiRoles.map((role) => ({ ...role, sessionId })),
    );
    return { savedAt: new Date().toISOString() };
  });

  handle(ipcMain, channels.strategy.getProviderModels, async (payload) => {
    const { providerKey } = strategyGetProviderModelsSchema.parse(payload);
    const provider = services.repos.providerAccounts.find(providerKey);
    if (!provider || provider.category !== "ai") {
      return { models: [] };
    }
    return { models: MODEL_CATALOG[provider.providerType as keyof typeof MODEL_CATALOG] ?? [] };
  });

  handle(ipcMain, channels.strategy.resetPrompt, async (payload) => {
    const { role } = strategyResetPromptSchema.parse(payload);
    return services.strategyContext.resetPrompt(role);
  });
}

function resolveSessionId(services: AppServices, payload: { sessionId?: string } | unknown): string {
  const sessionId = typeof payload === "object" && payload !== null && "sessionId" in payload ? payload.sessionId : undefined;
  return typeof sessionId === "string" && sessionId.length > 0 ? sessionId : services.repos.session.getFocusedSessionId();
}
