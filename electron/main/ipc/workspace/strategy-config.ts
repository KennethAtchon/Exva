import { ipcMain } from "electron";
import {
  strategyConfigApplyPresetSchema,
  strategyConfigDeletePresetSchema,
  strategyConfigGetSchema,
  strategyConfigHistorySchema,
  strategyConfigListPresetsSchema,
  strategyConfigRollbackSchema,
  strategyConfigSavePresetSchema,
  strategyConfigUpdateSchema,
} from "@electron/shared/validation/schemas";
import { channels } from "@electron/shared/ipc/channels";
import type { ConfigPresetKind } from "@electron/shared/domain/session-strategy-config";
import type { SessionStrategyConfigPatch } from "../../services/session/session-strategy-config-service";
import type { AppServices } from "../../services/app-services";
import { assertSessionInWorkspaceEnvironment } from "../environment-guards";
import { handle } from "../handle";
import { ipcPayloadUnknownSchema } from "../payload-schemas";

export function registerStrategyConfigHandlers(services: AppServices): void {
  handle(
    ipcMain,
    channels.strategyConfig.get,
    ipcPayloadUnknownSchema,
    async (payload) => {
      const { sessionId } = strategyConfigGetSchema.parse(payload);
      assertSessionInWorkspaceEnvironment(services, sessionId);
      return services.strategyConfig.get(sessionId);
    },
  );

  handle(
    ipcMain,
    channels.strategyConfig.update,
    ipcPayloadUnknownSchema,
    async (payload) => {
      const input = strategyConfigUpdateSchema.parse(payload);
      assertSessionInWorkspaceEnvironment(services, input.sessionId);
      return services.strategyConfig.update(
        input.sessionId,
        input.patch as SessionStrategyConfigPatch,
        input.expectedVersion,
      );
    },
  );

  handle(
    ipcMain,
    channels.strategyConfig.applyPreset,
    ipcPayloadUnknownSchema,
    async (payload) => {
      const input = strategyConfigApplyPresetSchema.parse(payload);
      assertSessionInWorkspaceEnvironment(services, input.sessionId);
      return services.strategyConfig.applyPreset(
        input.sessionId,
        input.presetId,
        input.expectedVersion,
      );
    },
  );

  handle(
    ipcMain,
    channels.strategyConfig.listPresets,
    ipcPayloadUnknownSchema,
    async (payload) => {
      const input = strategyConfigListPresetsSchema.parse(payload ?? {});
      return {
        presets: services.strategyConfig.listPresets(
          input?.kind as ConfigPresetKind | undefined,
        ),
      };
    },
  );

  handle(
    ipcMain,
    channels.strategyConfig.savePreset,
    ipcPayloadUnknownSchema,
    async (payload) => {
      const input = strategyConfigSavePresetSchema.parse(payload);
      return services.strategyConfig.savePreset({
        id: input.id,
        name: input.name,
        kind: input.kind,
        doc: input.doc as never,
        builtin: input.builtin,
      });
    },
  );

  handle(
    ipcMain,
    channels.strategyConfig.deletePreset,
    ipcPayloadUnknownSchema,
    async (payload) => {
      const { id } = strategyConfigDeletePresetSchema.parse(payload);
      services.strategyConfig.deletePreset(id);
      return { ok: true as const };
    },
  );

  handle(
    ipcMain,
    channels.strategyConfig.history,
    ipcPayloadUnknownSchema,
    async (payload) => {
      const { sessionId } = strategyConfigHistorySchema.parse(payload);
      assertSessionInWorkspaceEnvironment(services, sessionId);
      return { history: services.strategyConfig.history(sessionId) };
    },
  );

  handle(
    ipcMain,
    channels.strategyConfig.rollback,
    ipcPayloadUnknownSchema,
    async (payload) => {
      const input = strategyConfigRollbackSchema.parse(payload);
      assertSessionInWorkspaceEnvironment(services, input.sessionId);
      return services.strategyConfig.rollback(
        input.sessionId,
        input.version,
        input.expectedVersion,
      );
    },
  );
}
