import { ipcMain } from "electron";
import { AppError } from "@electron/shared/infra/errors";
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
    const current = services.repos.workspacePreferences.get();
    const next = { ...current, ...patch };

    if (next.capitalAllocationMode === "shared_global_pool") {
      if (next.globalCapitalPoolUsd == null || next.globalCapitalPoolUsd <= 0) {
        throw new AppError("Shared global pool requires a positive capital amount.", "VALIDATION_FAILED", {
          field: "globalCapitalPoolUsd",
        });
      }

      const reserved = services.repos.capitalReservations.sumActiveReservedUsd();
      if (reserved > next.globalCapitalPoolUsd) {
        throw new AppError("New shared pool ceiling is below currently-reserved capital.", "CAPITAL_POOL_EXCEEDED", {
          reserved,
          requested: next.globalCapitalPoolUsd,
        });
      }
    }

    return services.repos.workspacePreferences.update(patch);
  });
}
