import { ipcMain } from "electron";
import { z } from "zod";
import { channels } from "@electron/shared/ipc/channels";
import type {
  ExportFormat,
  PeriodAutopsyAddLessonInput,
  PeriodAutopsyLessonsListInput,
  PeriodAutopsyPromoteLessonInput,
  PeriodAutopsyRunInput,
  UpdateLessonInput,
} from "@electron/shared/domain/autopsy";
import { AppError } from "@electron/shared/infra/errors";
import type { AppServices } from "../../services/app-services";
import { assertSessionInWorkspaceEnvironment } from "../environment-guards";
import { handle } from "../handle";
import { ipcPayloadUnknownSchema } from "../payload-schemas";
import { requireJsonParse } from "../../services/infra/safe-json-parse";

const filtersSchema = z.object({
  instrumentClasses: z.array(z.string()).default([]),
  brokerAccountIds: z.array(z.string()).default([]),
  outcome: z.enum(["all", "winners", "losers"]).default("all"),
  minPositionSizeUsd: z.number().default(0),
  includeAgentPhases: z.array(z.string()).default([]),
});

const runSchema = z.object({
  scope: z.enum(["global", "session"]),
  sessionId: z.string().optional(),
  windowStart: z.string().min(1),
  windowEnd: z.string().min(1),
  filters: filtersSchema,
  providerKey: z.string().optional(),
  modelId: z.string().optional(),
  confirmHighCost: z.boolean().optional(),
});

const listSchema = z.object({
  scope: z.enum(["global", "session"]),
  sessionId: z.string().optional(),
  limit: z.number().int().positive().optional(),
  offset: z.number().int().min(0).optional(),
});

const getSchema = z.object({ periodAutopsyId: z.string().min(1) });

const lessonsListSchema = z.object({
  scope: z.enum(["global", "session"]),
  sessionId: z.string().optional(),
  status: z
    .array(
      z.enum(["pending", "implemented", "validated", "recurring", "dismissed"]),
    )
    .optional(),
});

const updateLessonSchema = z.object({
  lessonId: z.string().min(1),
  status: z
    .enum(["pending", "implemented", "validated", "recurring", "dismissed"])
    .optional(),
  lesson: z.string().optional(),
  proposedFix: z.string().optional(),
});

const addLessonSchema = z.object({
  scope: z.enum(["global", "session"]),
  sessionId: z.string().optional(),
  lesson: z.string().min(10),
  severity: z.enum(["low", "medium", "high", "critical"]),
  category: z.enum(["strategy", "execution", "behavioral", "risk", "system"]),
  proposedFix: z.string().default(""),
});

const promoteLessonSchema = z.object({
  lessonId: z.string().min(1),
  targetScope: z.enum(["global", "session"]),
  targetSessionId: z.string().optional(),
});

const exportSchema = z.object({
  periodAutopsyId: z.string().min(1),
  format: z.enum(["markdown", "json", "pdf"]),
});

export function registerPeriodAutopsyHandlers(services: AppServices): void {
  handle(
    ipcMain,
    channels.autopsy.period.run,
    ipcPayloadUnknownSchema,
    async (payload) => {
      const input = runSchema.parse(payload) as PeriodAutopsyRunInput;
      if (input.scope === "session") {
        if (!input.sessionId) {
          throw new AppError(
            "sessionId is required for session-scoped autopsy.",
            "VALIDATION_FAILED",
          );
        }
        assertSessionInWorkspaceEnvironment(services, input.sessionId);
      }
      return services.periodAutopsy.run(input);
    },
  );

  handle(
    ipcMain,
    channels.autopsy.period.preview,
    ipcPayloadUnknownSchema,
    async (payload) => {
      const input = runSchema.parse(payload) as PeriodAutopsyRunInput;
      if (input.scope === "session") {
        if (!input.sessionId) {
          throw new AppError(
            "sessionId is required for session-scoped autopsy.",
            "VALIDATION_FAILED",
          );
        }
        assertSessionInWorkspaceEnvironment(services, input.sessionId);
      }
      return services.periodAutopsy.preview(input);
    },
  );

  handle(
    ipcMain,
    channels.autopsy.period.list,
    ipcPayloadUnknownSchema,
    async (payload) => {
      const input = listSchema.parse(payload);
      if (input.scope === "session") {
        if (!input.sessionId) {
          throw new AppError(
            "sessionId is required for session-scoped autopsy.",
            "VALIDATION_FAILED",
          );
        }
        assertSessionInWorkspaceEnvironment(services, input.sessionId);
      }
      return services.periodAutopsy.listByScope(input);
    },
  );

  handle(
    ipcMain,
    channels.autopsy.period.get,
    ipcPayloadUnknownSchema,
    async (payload) => {
      const { periodAutopsyId } = getSchema.parse(payload);
      const record = services.periodAutopsy.getById(periodAutopsyId);
      if (record.scope === "session" && record.sessionId) {
        assertSessionInWorkspaceEnvironment(services, record.sessionId);
      }
      return record;
    },
  );

  handle(
    ipcMain,
    channels.autopsy.period.lessons.list,
    ipcPayloadUnknownSchema,
    async (payload) => {
      const input = lessonsListSchema.parse(
        payload,
      ) as PeriodAutopsyLessonsListInput;
      if (input.scope === "session") {
        if (!input.sessionId) {
          throw new AppError(
            "sessionId is required for session-scoped autopsy.",
            "VALIDATION_FAILED",
          );
        }
        assertSessionInWorkspaceEnvironment(services, input.sessionId);
      }
      return services.periodAutopsy.listLessons(input);
    },
  );

  handle(
    ipcMain,
    channels.autopsy.period.lessons.update,
    ipcPayloadUnknownSchema,
    async (payload) => {
      const input = updateLessonSchema.parse(payload) as UpdateLessonInput;
      services.periodAutopsy.updateLesson(input.lessonId, input);
      return { ok: true as const };
    },
  );

  handle(
    ipcMain,
    channels.autopsy.period.lessons.add,
    ipcPayloadUnknownSchema,
    async (payload) => {
      const input = addLessonSchema.parse(
        payload,
      ) as PeriodAutopsyAddLessonInput;
      if (input.scope === "session") {
        if (!input.sessionId) {
          throw new AppError(
            "sessionId is required for session-scoped autopsy.",
            "VALIDATION_FAILED",
          );
        }
        assertSessionInWorkspaceEnvironment(services, input.sessionId);
      }
      return services.periodAutopsy.addLesson(input);
    },
  );

  handle(
    ipcMain,
    channels.autopsy.period.lessons.promote,
    ipcPayloadUnknownSchema,
    async (payload) => {
      const input = promoteLessonSchema.parse(
        payload,
      ) as PeriodAutopsyPromoteLessonInput;
      if (input.targetScope === "session") {
        if (!input.targetSessionId) {
          throw new AppError(
            "targetSessionId is required for session-scoped autopsy.",
            "VALIDATION_FAILED",
          );
        }
        assertSessionInWorkspaceEnvironment(services, input.targetSessionId);
      }
      return services.periodAutopsy.promoteLesson(input);
    },
  );

  handle(
    ipcMain,
    channels.autopsy.period.export,
    ipcPayloadUnknownSchema,
    async (payload, event) => {
      const { periodAutopsyId, format } = exportSchema.parse(payload) as {
        periodAutopsyId: string;
        format: ExportFormat;
      };
      const record = services.periodAutopsy.getById(periodAutopsyId);
      if (record.scope === "session" && record.sessionId) {
        assertSessionInWorkspaceEnvironment(services, record.sessionId);
      }
      const lessons =
        services.repos.autopsyLessons.listByPeriodAutopsy(periodAutopsyId);
      const trades = services.repos.trades.listByIds(
        requireJsonParse<string[]>(
          record.tradeIdsJson,
          undefined,
          "Invalid period autopsy tradeIdsJson",
        ),
      );
      return services.autopsyExport.exportPeriod(
        format,
        record,
        lessons,
        trades,
        event.sender,
      );
    },
  );
}
