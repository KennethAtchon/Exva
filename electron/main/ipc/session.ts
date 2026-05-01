import { ipcMain } from "electron";
import { AppError } from "@electron/shared/errors";
import { channels } from "@electron/shared/channels";
import {
  sessionCreateInputSchema,
  sessionDuplicateInputSchema,
  sessionListFiltersSchema,
  sessionUpdateInputSchema,
} from "@electron/shared/schemas";
import type { AppServices } from "../services/app-services";
import { handle } from "./handle";

export function registerSessionHandlers(services: AppServices): void {
  handle(ipcMain, channels.session.start, async () => services.session.start());
  handle(ipcMain, channels.session.pause, async () => services.session.pause());
  handle(ipcMain, channels.session.resume, async () => services.session.resume());
  handle(ipcMain, channels.session.stop, async () => services.session.stop());
  handle(ipcMain, channels.session.getStatus, async () => services.session.getStatus());

  handle(ipcMain, channels.session.list, async (payload) => {
    const filters = sessionListFiltersSchema.parse(payload) ?? {};
    return services.sessionListing.list(filters);
  });

  handle(ipcMain, channels.session.create, async (payload) => {
    const input = sessionCreateInputSchema.parse(payload);
    return services.sessionWrites.create(input);
  });

  handle(ipcMain, channels.session.update, async (payload) => {
    const { id, input } = sessionUpdateInputSchema.parse(payload);
    return services.sessionWrites.update(id, input);
  });

  handle(ipcMain, channels.session.focus, async (payload) => {
    const id = (payload as { id: string }).id;
    services.repos.session.setFocus(id);
    return { workspaceViewMode: "session" as const, focusedSessionId: id };
  });

  handle(ipcMain, channels.session.goGlobal, async () => {
    const sessions = services.repos.session.list({ includeArchived: false }).filter((session) => session.status !== "archived");
    if (sessions.length === 0) {
      throw new AppError("Cannot switch to global mode without sessions.", "VALIDATION_FAILED");
    }
    services.repos.session.clearFocus();
    return { workspaceViewMode: "global" as const, focusedSessionId: null };
  });

  handle(ipcMain, channels.session.archive, async (payload) => {
    const id = (payload as { id: string }).id;
    const session = services.repos.session.requireById(id);
    if (session.status === "active" || session.status === "paused") {
      throw new AppError("Stop the session before archiving it.", "INVALID_TRANSITION", { id });
    }
    services.repos.session.setStatus("archived", id);
    if (session.isFocused) {
      services.repos.session.clearFocus();
    }
    return { archived: true };
  });

  handle(ipcMain, channels.session.duplicate, async (payload) => {
    const { sourceId, name } = sessionDuplicateInputSchema.parse(payload);
    const session = services.repos.session.duplicate(sourceId, { name });
    return { id: session.id, status: "draft" as const };
  });
}
