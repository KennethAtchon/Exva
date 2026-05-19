import { ipcMain } from "electron";
import {
  strategyAiPhaseSaveSchema,
  strategyAiPhaseWorkerSaveSchema,
  strategyGetProviderModelsSchema,
  strategyRiskConfigSaveSchema,
  strategyRulesSaveSchema,
  strategyResearchPostureSaveSchema,
  strategyTimeframeConfigSaveSchema,
} from "@electron/shared/validation/schemas";
import { channels } from "@electron/shared/ipc/channels";
import { AppError } from "@electron/shared/infra/errors";
import type { AppServices } from "../services/app-services";
import { handle } from "./handle";

export function registerStrategyHandlers(services: AppServices): void {
  handle(ipcMain, channels.strategy.get, async (payload) => {
    const sessionId = resolveSessionId(services, payload);
    return services.strategyContext.getPageData(sessionId);
  });

  handle(ipcMain, channels.strategy.getResearchPosture, async (payload) => {
    const sessionId = resolveSessionId(services, payload);
    return services.strategyContext.getResearchPosture(sessionId);
  });

  handle(ipcMain, channels.strategy.saveResearchPosture, async (payload) => {
    const input = strategyResearchPostureSaveSchema.parse(payload);
    services.strategyContext.saveResearchPosture(resolveSessionId(services, input), input.researchPosture);
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

  handle(ipcMain, channels.strategy.saveAiPhase, async (payload) => {
    const input = strategyAiPhaseSaveSchema.parse(payload);
    const sessionId = resolveSessionId(services, input);
    const { sessionId: _ignored, phase, ...patch } = input;
    services.strategyContext.saveAiPhase(sessionId, { phase, ...patch });
    return { savedAt: new Date().toISOString() };
  });

  handle(ipcMain, channels.strategy.saveAiPhaseWorker, async (payload) => {
    const input = strategyAiPhaseWorkerSaveSchema.parse(payload);
    const sessionId = resolveSessionId(services, input);
    services.strategyContext.saveAiPhaseWorker(sessionId, {
      sessionId,
      phase: input.phase,
      workerId: input.workerId,
      providerKey: input.providerKey ?? null,
      modelId: input.modelId ?? null,
      maxSteps: input.maxSteps ?? null,
      spendLimitUsd: input.spendLimitUsd ?? null,
      promptMarkdown: input.promptMarkdown ?? null,
      updatedAt: new Date().toISOString(),
    });
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

  handle(ipcMain, channels.strategy.globalPresets.list, async () => {
    return { presets: services.repos.globalPresets.list() };
  });

  handle(ipcMain, channels.strategy.globalPresets.create, async (payload) => {
    const { name, preset } = payload as { name: string; preset: Record<string, unknown> };
    return services.repos.globalPresets.insert({ name, preset: preset as Parameters<typeof services.repos.globalPresets.insert>[0]["preset"] });
  });

  handle(ipcMain, channels.strategy.globalPresets.update, async (payload) => {
    const { id, name, preset } = payload as { id: string; name: string; preset: Record<string, unknown> };
    services.repos.globalPresets.update(id, { name, preset: preset as Parameters<typeof services.repos.globalPresets.update>[1]["preset"] });
    return { ok: true };
  });

  handle(ipcMain, channels.strategy.globalPresets.delete, async (payload) => {
    const { id } = payload as { id: string };
    services.repos.globalPresets.delete(id);
    return { ok: true };
  });

  handle(ipcMain, channels.strategy.getWorkspaceDefaultModel, async () => {
    const prefs = services.repos.workspacePreferences.get();
    return { providerKey: prefs.defaultModelProviderKey, modelId: prefs.defaultModelModelId };
  });

  handle(ipcMain, channels.strategy.saveWorkspaceDefaultModel, async (payload) => {
    const { providerKey, modelId } = payload as { providerKey: string; modelId: string };

    if (!providerKey.trim()) {
      throw new AppError("Select an AI provider for the workspace default model.", "VALIDATION_FAILED", {
        field: "providerKey",
      });
    }

    if (!modelId.trim()) {
      throw new AppError("Select a model for the workspace default AI provider.", "VALIDATION_FAILED", {
        field: "modelId",
      });
    }

    const provider = services.repos.providerAccounts.find(providerKey);
    if (!provider || provider.category !== "ai") {
      throw new AppError("Workspace default AI model must use an existing AI provider account.", "PROVIDER_NOT_CONFIGURED", {
        field: "providerKey",
        providerKey,
      });
    }

    if (!provider.isConfigured) {
      throw new AppError("Connect this AI provider in Accounts before setting it as the workspace default.", "PROVIDER_NOT_CONFIGURED", {
        field: "providerKey",
        providerKey,
      });
    }

    services.repos.workspacePreferences.update({ defaultModelProviderKey: providerKey, defaultModelModelId: modelId });
    services.repos.sessionAiPhases.backfillMissingProviderModel({ providerKey, modelId });
    return { savedAt: new Date().toISOString() };
  });
}

function resolveSessionId(services: AppServices, payload: { sessionId?: string } | unknown): string {
  const sessionId = typeof payload === "object" && payload !== null && "sessionId" in payload ? payload.sessionId : undefined;
  return typeof sessionId === "string" && sessionId.length > 0 ? sessionId : services.repos.session.getFocusedSessionId();
}
