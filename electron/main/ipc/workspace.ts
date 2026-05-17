import { ipcMain } from "electron";
import { channels } from "@electron/shared/ipc/channels";
import { workspacePrefsPatchSchema } from "@electron/shared/validation/schemas";
import type { AppServices } from "../services/app-services";
import { handle } from "./handle";

export function registerWorkspaceHandlers(services: AppServices): void {
  handle(ipcMain, channels.workspace.viewGet, async () => {
    const focused = services.repos.session.getFocused();
    return {
      workspaceViewMode: focused ? "session" : "global",
      focusedSessionId: focused?.id ?? null,
      preferences: services.repos.workspacePreferences.get(),
    };
  });

  handle(ipcMain, channels.workspace.prefsPatch, async (payload) => {
    const patch = workspacePrefsPatchSchema.parse(payload ?? {});
    return services.repos.workspacePreferences.update(patch);
  });
}
