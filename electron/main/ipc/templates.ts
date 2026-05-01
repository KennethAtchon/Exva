import { ipcMain } from "electron";
import { AppError } from "@electron/shared/errors";
import { channels } from "@electron/shared/channels";
import type { SessionTemplatePayload } from "@/lib/types";
import type { AppServices } from "../services/app-services";
import { handle } from "./handle";

export function registerTemplateHandlers(services: AppServices): void {
  handle(ipcMain, channels.templates.list, async (payload) => {
    const filters = (payload ?? {}) as { search?: string; instrumentClass?: string };
    const sessionsById = new Map(services.repos.session.list({ includeArchived: true }).map((session) => [session.id, session]));
    const templates = services.repos.sessionTemplates
      .list()
      .filter((template) => !filters.search || template.name.toLowerCase().includes(filters.search.toLowerCase()))
      .filter(
        (template) =>
          !filters.instrumentClass || template.instrumentClasses.includes(filters.instrumentClass as SessionTemplatePayload["identity"]["instrumentClasses"][number]),
      )
      .map((template) => ({
        id: template.id,
        name: template.name,
        description: template.description,
        sourceSessionId: template.sourceSessionId,
        sourceSessionName: template.sourceSessionId ? sessionsById.get(template.sourceSessionId)?.name ?? null : null,
        instrumentClasses: template.instrumentClasses,
        updatedAt: template.updatedAt,
      }));

    return { templates };
  });

  handle(ipcMain, channels.templates.create, async (payload) => {
    const input = payload as {
      name: string;
      description?: string;
      sourceSessionId?: string;
      payload: SessionTemplatePayload;
    };

    if (!input?.name?.trim()) {
      throw new AppError("Template name is required.", "VALIDATION_FAILED", { field: "name" });
    }

    return services.repos.sessionTemplates.create({
      name: input.name.trim(),
      description: input.description,
      sourceSessionId: input.sourceSessionId,
      payload: input.payload,
    });
  });

  handle(ipcMain, channels.templates.delete, async (payload) => {
    const id = (payload as { id: string }).id;
    if (!services.repos.sessionTemplates.delete(id)) {
      throw new AppError(`Template ${id} was not found`, "NOT_FOUND", { id });
    }
    return { deleted: true };
  });

  handle(ipcMain, channels.templates.use, async (payload) => {
    const id = (payload as { id: string }).id;
    const template = services.repos.sessionTemplates.get(id);
    if (!template) {
      throw new AppError(`Template ${id} was not found`, "NOT_FOUND", { id });
    }

    const raw = JSON.parse(template.templatePayloadJson) as SessionTemplatePayload;
    const clearedFields: string[] = [];

    const providerIds = new Set(services.repos.providerAccounts.list().map((provider) => provider.id));
    const brokerIds = new Set(services.repos.brokerAccounts.list().map((broker) => broker.id));

    raw.aiRoles = raw.aiRoles.map((role, index) => {
      if (role.providerKey && !providerIds.has(role.providerKey)) {
        clearedFields.push(`aiRoles[${index}].providerKey`);
        return { ...role, providerKey: "" };
      }
      return role;
    });

    raw.brokerAssignments = raw.brokerAssignments.map((assignment, index) => {
      if (!brokerIds.has(assignment.brokerAccountId)) {
        clearedFields.push(`brokerAssignments[${index}]`);
        return { brokerAccountId: "" };
      }
      return assignment;
    });

    for (const instrumentClass of Object.keys(raw.brokerOverridesByInstrumentClass) as Array<keyof typeof raw.brokerOverridesByInstrumentClass>) {
      const brokerAccountId = raw.brokerOverridesByInstrumentClass[instrumentClass];
      if (brokerAccountId && !brokerIds.has(brokerAccountId)) {
        clearedFields.push(`brokerOverridesByInstrumentClass.${instrumentClass}`);
        delete raw.brokerOverridesByInstrumentClass[instrumentClass];
      }
    }

    return { payload: raw, clearedFields };
  });
}
