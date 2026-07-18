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
import type { AppServices } from "../../services/app-services";
import { assertSessionInWorkspaceEnvironment } from "../environment-guards";
import { handle } from "../handle";
import { safeJsonParse } from "../../services/infra/safe-json-parse";

const idSchema = z.object({ id: z.string().min(1) });
const sessionIdSchema = z.object({ sessionId: z.string().min(1) });

export function registerTemplateHandlers(services: AppServices): void {
  handle(
    ipcMain,
    channels.templates.list,
    templateListFiltersSchema,
    async (filters) => {
      const prefs = services.repos.workspacePreferences.get();
      const requiredMode = executionModeForEnvironment(
        prefs.globalEnvironmentMode,
      );
      const templates = services.sessionTemplates
        .list(filters ?? {})
        .filter((item) => {
          const row = services.repos.sessionTemplates.get(item.id);
          if (!row) return false;
          const templatePayload = safeJsonParse(
            row.templatePayloadJson,
            undefined,
            "templates.list.payload",
          );
          if (templatePayload == null) return false;
          const parsed =
            sessionTemplatePayloadSchema.safeParse(templatePayload);
          return (
            parsed.success &&
            parsed.data.identity.executionMode === requiredMode
          );
        });
      return { templates };
    },
  );

  handle(
    ipcMain,
    channels.templates.create,
    templateCreateInputSchema,
    async (input) => services.sessionTemplates.create(input),
  );

  handle(ipcMain, channels.templates.delete, idSchema, async ({ id }) => {
    services.sessionTemplates.delete(id);
    return { deleted: true as const };
  });

  handle(ipcMain, channels.templates.use, idSchema, async ({ id }) => {
    const row = services.repos.sessionTemplates.get(id);
    if (!row) {
      throw new AppError(`Template ${id} was not found`, "NOT_FOUND", { id });
    }
    const templatePayload = safeJsonParse(
      row.templatePayloadJson,
      undefined,
      "templates.use.payload",
    );
    const parsed = sessionTemplatePayloadSchema.safeParse(templatePayload);
    const prefs = services.repos.workspacePreferences.get();
    const requiredMode = executionModeForEnvironment(
      prefs.globalEnvironmentMode,
    );
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
    sessionIdSchema,
    async ({ sessionId }) => {
      assertSessionInWorkspaceEnvironment(services, sessionId);
      return services.sessionTemplates.buildPayloadFromSession(sessionId);
    },
  );
}
