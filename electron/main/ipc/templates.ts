import { ipcMain } from "electron";
import { AppError } from "@electron/shared/errors";
import { channels } from "@electron/shared/channels";
import {
  templateCreateInputSchema,
  templateListFiltersSchema,
} from "@electron/shared/schemas";
import { z } from "zod";
import type { AppServices } from "../services/app-services";
import { handle } from "./handle";

const idSchema = z.object({ id: z.string().min(1) });

export function registerTemplateHandlers(services: AppServices): void {
  handle(ipcMain, channels.templates.list, async (payload) => {
    const filters = templateListFiltersSchema.parse(payload) ?? {};
    return { templates: services.sessionTemplates.list(filters) };
  });

  handle(ipcMain, channels.templates.create, async (payload) => {
    const input = templateCreateInputSchema.parse(payload);
    return services.sessionTemplates.create(input);
  });

  handle(ipcMain, channels.templates.delete, async (payload) => {
    const { id } = idSchema.parse(payload);
    services.sessionTemplates.delete(id);
    return { deleted: true as const };
  });

  handle(ipcMain, channels.templates.use, async (payload) => {
    const { id } = idSchema.parse(payload);
    return services.sessionTemplates.apply(id);
  });

  handle(ipcMain, channels.templates.buildPayloadFromSession, async (payload) => {
    const { sessionId } = z.object({ sessionId: z.string().min(1) }).parse(payload);
    return services.sessionTemplates.buildPayloadFromSession(sessionId);
  });
  void AppError;
}
