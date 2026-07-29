import { ipcMain } from "electron";
import { sessionIdParamSchema } from "@electron/shared/validation/schemas";
import { channels } from "@electron/shared/ipc/channels";
import type { AppServices } from "../../services/app-services";
import { assertSessionInWorkspaceEnvironment } from "../environment-guards";
import { handle } from "../handle";
import { ipcPayloadUnknownSchema } from "../payload-schemas";

export function registerSessionActivityHandlers(services: AppServices): void {
  handle(
    ipcMain,
    channels.sessionActivity.list,
    ipcPayloadUnknownSchema,
    async () => services.sessionActivityTracker.listSnapshots(),
  );

  handle(
    ipcMain,
    channels.sessionActivity.get,
    ipcPayloadUnknownSchema,
    async (payload) => {
      const { sessionId } = sessionIdParamSchema.parse(payload);
      assertSessionInWorkspaceEnvironment(services, sessionId);
      return services.sessionActivityTracker.getSnapshot(sessionId);
    },
  );

  handle(
    ipcMain,
    channels.sessionActivity.listTransitions,
    ipcPayloadUnknownSchema,
    async (payload) => {
      const { sessionId } = sessionIdParamSchema.parse(payload);
      assertSessionInWorkspaceEnvironment(services, sessionId);
      return services.sessionActivityTracker.listTransitions(sessionId);
    },
  );

  handle(
    ipcMain,
    channels.sessionActivity.monitoringHealth,
    ipcPayloadUnknownSchema,
    async () => services.sessionActivityTracker.getMonitoringHealth(),
  );

  handle(
    ipcMain,
    channels.sessionActivity.analytics,
    ipcPayloadUnknownSchema,
    async (payload) => {
      const { sessionId } = sessionIdParamSchema.parse(payload);
      assertSessionInWorkspaceEnvironment(services, sessionId);
      return services.sessionActivityTracker.getAnalytics(sessionId);
    },
  );

  handle(
    ipcMain,
    channels.sessionActivity.firstDivergence,
    ipcPayloadUnknownSchema,
    async (payload) => {
      const { sessionId } = sessionIdParamSchema.parse(payload);
      assertSessionInWorkspaceEnvironment(services, sessionId);
      return services.cycleFunnel.firstDivergence(sessionId);
    },
  );
}
