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
}
