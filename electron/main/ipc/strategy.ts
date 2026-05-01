import { ipcMain } from "electron";
import { isSessionEditable } from "@electron/shared/domain";
import { AppError } from "@electron/shared/errors";
import { channels } from "@electron/shared/channels";
import type { AgentRole, SessionAiRole, SessionStrategy } from "@/lib/types";
import type { AppServices } from "../services/app-services";
import { MODEL_CATALOG } from "../services/ai/provider-model-catalog";
import { handle } from "./handle";

export function registerStrategyHandlers(services: AppServices): void {
  handle(ipcMain, channels.strategy.get, async (payload) => {
    const sessionId = resolveSessionId(services, payload);
    const session = services.repos.session.requireById(sessionId);
    const strategy = services.repos.sessionStrategies.get(sessionId);
    const selectorSettings = services.repos.sessionSelectorSettings.get(sessionId);
    const aiRoles = services.repos.sessionAiRoles.listBySession(sessionId).map((role) => {
      if (role.promptSource === "default") {
        return {
          ...role,
          promptMarkdown: services.promptAssetLoader.load(role.role),
          promptAssetPath: services.promptAssetLoader.assetPath(role.role),
        };
      }
      return role;
    });

    return {
      strategy,
      aiRoles,
      selectorSettings,
      providers: services.repos.providerAccounts.list().filter((provider) => provider.category === "ai"),
      sessionStatus: session.status,
      selectionMode: session.selectionMode,
      defaultSearchProviderId: session.defaultSearchProviderId,
      workspaceDefaultSearchProviderId: services.repos.workspacePreferences.get().defaultSearchProviderId,
    };
  });

  handle(ipcMain, channels.strategy.save, async (payload) => {
    const input = payload as { sessionId?: string; strategy: Partial<SessionStrategy>; aiRoles: SessionAiRole[] };
    const sessionId = resolveSessionId(services, input);
    const session = services.repos.session.requireById(sessionId);
    if (!isSessionEditable(session.status)) {
      throw new AppError("Stop this session before editing its strategy or AI configuration.", "LOCKED", { sessionId });
    }

    validateStrategySave(services, sessionId, input.aiRoles);
    services.repos.sessionStrategies.update(sessionId, input.strategy);
    services.repos.sessionAiRoles.replaceAll(sessionId, input.aiRoles);

    return { savedAt: new Date().toISOString() };
  });

  handle(ipcMain, channels.strategy.getProviderModels, async (payload) => {
    const providerKey = (payload as { providerKey: string }).providerKey;
    const provider = services.repos.providerAccounts.find(providerKey);
    if (!provider || provider.category !== "ai") {
      return { models: [] };
    }
    return { models: MODEL_CATALOG[provider.providerType as keyof typeof MODEL_CATALOG] ?? [] };
  });

  handle(ipcMain, channels.strategy.resetPrompt, async (payload) => {
    const role = (payload as { role: AgentRole }).role;
    return {
      promptMarkdown: services.promptAssetLoader.load(role),
      promptAssetPath: services.promptAssetLoader.assetPath(role),
    };
  });
}

function resolveSessionId(services: AppServices, payload: { sessionId?: string } | unknown): string {
  const sessionId = typeof payload === "object" && payload !== null && "sessionId" in payload ? payload.sessionId : undefined;
  return typeof sessionId === "string" && sessionId.length > 0 ? sessionId : services.repos.session.getFocusedSessionId();
}

function validateStrategySave(services: AppServices, sessionId: string, aiRoles: SessionAiRole[]): void {
  const session = services.repos.session.requireById(sessionId);
  const workspacePrefs = services.repos.workspacePreferences.get();

  for (const role of aiRoles) {
    const provider = services.repos.providerAccounts.find(role.providerKey);
    if (!provider || !provider.isConfigured) {
      throw new AppError("Connect this provider in Accounts before assigning it to a role.", "PROVIDER_NOT_CONFIGURED", {
        role: role.role,
      });
    }
    if (!role.modelId.trim()) {
      throw new AppError(`Select a model for ${role.role}.`, "VALIDATION_FAILED", { role: role.role, field: "modelId" });
    }
    if (role.promptSource === "session_override" && !role.promptMarkdown.trim()) {
      throw new AppError("Prompt cannot be empty. Reset to default or add content.", "VALIDATION_FAILED", {
        role: role.role,
        field: "promptMarkdown",
      });
    }
    if (role.webSearchEnabled && !session.defaultSearchProviderId && !workspacePrefs.defaultSearchProviderId) {
      throw new AppError("Connect a web search provider to enable internet search for this role.", "SEARCH_PROVIDER_REQUIRED", {
        role: role.role,
      });
    }
  }
}
