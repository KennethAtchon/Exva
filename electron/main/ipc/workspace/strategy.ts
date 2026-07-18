import { ipcMain } from "electron";
import { strategyGetProviderModelsSchema } from "@electron/shared/validation/schemas";
import { channels } from "@electron/shared/ipc/channels";
import {
  REASONING_LEVELS,
  type ReasoningLevel,
} from "@electron/shared/ai/ai-phase";
import { AppError } from "@electron/shared/infra/errors";
import type { AppServices } from "../../services/app-services";
import { assertSessionInWorkspaceEnvironment } from "../environment-guards";
import { handle } from "../handle";
import {
  ipcNoPayloadSchema,
  ipcPayloadUnknownSchema,
} from "../payload-schemas";

export function registerStrategyHandlers(services: AppServices): void {
  handle(
    ipcMain,
    channels.strategy.get,
    ipcPayloadUnknownSchema,
    async (payload) => {
      const sessionId = resolveSessionId(services, payload);
      return services.strategyContext.getPageData(sessionId);
    },
  );

  handle(
    ipcMain,
    channels.strategy.getProviderModels,
    ipcPayloadUnknownSchema,
    async (payload) => {
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
    },
  );

  handle(
    ipcMain,
    channels.strategy.getWorkspaceDefaultModel,
    ipcNoPayloadSchema,
    async () => {
      const prefs = services.repos.workspacePreferences.get();
      return {
        providerKey: prefs.defaultModelProviderKey,
        modelId: prefs.defaultModelModelId,
        reasoningLevel: prefs.defaultModelReasoningLevel,
      };
    },
  );

  handle(
    ipcMain,
    channels.strategy.saveWorkspaceDefaultModel,
    ipcPayloadUnknownSchema,
    async (payload) => {
      const { providerKey, modelId, reasoningLevel } = payload as {
        providerKey: string;
        modelId: string;
        reasoningLevel?: ReasoningLevel;
      };

      if (!providerKey.trim()) {
        throw new AppError(
          "Select an AI provider for the workspace default model.",
          "VALIDATION_FAILED",
          {
            field: "providerKey",
          },
        );
      }

      if (!modelId.trim()) {
        throw new AppError(
          "Select a model for the workspace default AI provider.",
          "VALIDATION_FAILED",
          {
            field: "modelId",
          },
        );
      }

      const provider = services.repos.providerAccounts.find(providerKey);
      if (!provider || provider.category !== "ai") {
        throw new AppError(
          "Workspace default AI model must use an existing AI provider account.",
          "PROVIDER_NOT_CONFIGURED",
          {
            field: "providerKey",
            providerKey,
          },
        );
      }

      if (!provider.isConfigured) {
        throw new AppError(
          "Connect this AI provider in Accounts before setting it as the workspace default.",
          "PROVIDER_NOT_CONFIGURED",
          {
            field: "providerKey",
            providerKey,
          },
        );
      }

      const resolvedReasoningLevel =
        reasoningLevel &&
        (REASONING_LEVELS as readonly string[]).includes(reasoningLevel)
          ? reasoningLevel
          : "off";

      services.repos.workspacePreferences.update({
        defaultModelProviderKey: providerKey,
        defaultModelModelId: modelId,
        defaultModelReasoningLevel: resolvedReasoningLevel,
      });
      services.strategyConfig.backfillMissingProviderModel({
        providerKey,
        modelId,
      });
      services.strategyConfig.backfillDefaultReasoningLevel(
        resolvedReasoningLevel,
      );
      return { savedAt: new Date().toISOString() };
    },
  );
}

function resolveSessionId(
  services: AppServices,
  payload: { sessionId?: string } | unknown,
): string {
  const sessionId =
    typeof payload === "object" && payload !== null && "sessionId" in payload
      ? payload.sessionId
      : undefined;
  const resolved =
    typeof sessionId === "string" && sessionId.length > 0
      ? sessionId
      : services.repos.session.getFocusedSessionId();
  assertSessionInWorkspaceEnvironment(services, resolved);
  return resolved;
}
