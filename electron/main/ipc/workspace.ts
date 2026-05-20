import { ipcMain } from "electron";
import { workspaceEndpoints } from "@electron/shared/ipc/endpoints";
import type { AppServices } from "../services/app-services";
import { handle } from "./handle";

export function registerWorkspaceHandlers(services: AppServices): void {
  handle(ipcMain, workspaceEndpoints.getView.channel, async () => {
    const focused = services.repos.session.getFocused();
    return {
      workspaceViewMode: focused ? "session" : "global",
      focusedSessionId: focused?.id ?? null,
      preferences: services.repos.workspacePreferences.get(),
    };
  });

  handle(
    ipcMain,
    workspaceEndpoints.patchPreferences.channel,
    async (payload) => {
      return services.repos.workspacePreferences.update(
        workspaceEndpoints.patchPreferences.parseInput(payload),
      );
    },
  );
}
