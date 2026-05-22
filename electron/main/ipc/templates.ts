import { ipcMain } from "electron";
import { AppError } from "@electron/shared/infra/errors";
import { channels } from "@electron/shared/ipc/channels";
import {
  templateCreateInputSchema,
  templateListFiltersSchema,
} from "@electron/shared/validation/schemas";
import { z } from "zod";
import { executionModeForEnvironment } from "@electron/shared/domain/environment-mode";
import { sessionTemplatePayloadSchema } from "@electron/shared/validation/schemas";
import type { AppServices } from "../services/app-services";
import { assertSessionInWorkspaceEnvironment } from "./environment-guards";
import { handle } from "./handle";

const idSchema = z.object({ id: z.string().min(1) });

export function registerTemplateHandlers(services: AppServices): void {
  handle(ipcMain, channels.templates.list, async (payload) => {
    const filters = templateListFiltersSchema.parse(payload) ?? {};
    const prefs = services.repos.workspacePreferences.get();
    const requiredMode = executionModeForEnvironment(prefs.globalEnvironmentMode);
    const templates = services.sessionTemplates.list(filters).filter((item) => {
      const row = services.repos.sessionTemplates.get(item.id);
      if (!row) return false;
      const parsed = sessionTemplatePayloadSchema.safeParse(
        JSON.parse(row.templatePayloadJson),
      );
      return (
        parsed.success && parsed.data.identity.executionMode === requiredMode
      );
    });
    return { templates };
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
    const row = services.repos.sessionTemplates.get(id);
    if (!row) {
      throw new AppError(`Template ${id} was not found`, "NOT_FOUND", { id });
    }
    const parsed = sessionTemplatePayloadSchema.safeParse(
      JSON.parse(row.templatePayloadJson),
    );
    const prefs = services.repos.workspacePreferences.get();
    const requiredMode = executionModeForEnvironment(prefs.globalEnvironmentMode);
    if (
      !parsed.success ||
      parsed.data.identity.executionMode !== requiredMode
    ) {
      throw new AppError(
        `Template is not available in the current ${prefs.globalEnvironmentMode} workspace environment.`,
        "VALIDATION_FAILED",
        { id },
      );
    }
    return services.sessionTemplates.apply(id);
  });

  handle(
    ipcMain,
    channels.templates.buildPayloadFromSession,
    async (payload) => {
      const { sessionId } = z
        .object({ sessionId: z.string().min(1) })
        .parse(payload);
      assertSessionInWorkspaceEnvironment(services, sessionId);
      return services.sessionTemplates.buildPayloadFromSession(sessionId);
    },
  );
  void AppError;
}
