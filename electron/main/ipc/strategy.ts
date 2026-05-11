import { ipcMain } from "electron";
import {
  strategyAiRolesSaveSchema,
  strategyGetProviderModelsSchema,
  strategyResetPromptSchema,
  strategyRiskConfigSaveSchema,
  strategyRulesSaveSchema,
  strategyStyleSaveSchema,
  strategyTimeframeConfigSaveSchema,
} from "@electron/shared/schemas";
import { channels } from "@electron/shared/channels";
import type { AppServices } from "../services/app-services";
import { handle } from "./handle";

export function registerStrategyHandlers(services: AppServices): void {
  handle(ipcMain, channels.strategy.get, async (payload) => {
    const sessionId = resolveSessionId(services, payload);
    return services.strategyContext.getPageData(sessionId);
  });

  handle(ipcMain, channels.strategy.getStyle, async (payload) => {
    const sessionId = resolveSessionId(services, payload);
    return services.strategyContext.getStyle(sessionId);
  });

  handle(ipcMain, channels.strategy.saveStyle, async (payload) => {
    const input = strategyStyleSaveSchema.parse(payload);
    services.strategyContext.saveStyle(resolveSessionId(services, input), input.style);
    return { savedAt: new Date().toISOString() };
  });

  handle(ipcMain, channels.strategy.getRules, async (payload) => {
    const sessionId = resolveSessionId(services, payload);
    return services.strategyContext.getRules(sessionId);
  });

  handle(ipcMain, channels.strategy.saveRules, async (payload) => {
    const input = strategyRulesSaveSchema.parse(payload);
    services.strategyContext.saveRules(resolveSessionId(services, input), input.rules);
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
    try {
      const models = await services.providerRegistry.listModels(providerKey);
      return { models };
    } catch {
      return { models: [] };
    }
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
