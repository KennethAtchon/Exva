import { ipcMain } from "electron";
import { z } from "zod";
import { tradeIdSchema } from "@/lib/schemas";
import { channels } from "@electron/shared/ipc/channels";
import { AppError } from "@electron/shared/infra/errors";
import type {
  AddLessonInput,
  ExportFormat,
  UpdateLessonInput,
} from "@electron/shared/domain/autopsy";
import type { AppServices } from "../../services/app-services";
import { assertSessionInWorkspaceEnvironment } from "../environment-guards";
import { handle } from "../handle";
import { ipcPayloadUnknownSchema } from "../payload-schemas";

const autopsyIdSchema = z.object({ autopsyId: z.string().min(1) });

const exportSchema = z.object({
  autopsyId: z.string().min(1),
  format: z.enum(["markdown", "json", "pdf"]),
});

const addLessonSchema = z.object({
  autopsyId: z.string().min(1),
  tradeId: z.string().min(1),
  sessionId: z.string().min(1),
  lesson: z.string().min(1),
  severity: z.enum(["low", "medium", "high", "critical"]),
  category: z.enum(["strategy", "execution", "behavioral", "risk", "system"]),
  proposedFix: z.string(),
});

const updateLessonSchema = z.object({
  lessonId: z.string().min(1),
  status: z
    .enum(["pending", "implemented", "validated", "recurring", "dismissed"])
    .optional(),
  lesson: z.string().optional(),
  proposedFix: z.string().optional(),
});

export function registerAutopsyHandlers(services: AppServices): void {
  handle(
    ipcMain,
    channels.trades.autopsy.summarize,
    ipcPayloadUnknownSchema,
    async (payload) => {
      const { tradeId } = tradeIdSchema.parse(payload);
      const trade = services.repos.trades.require(tradeId);
      if (trade.sessionId) {
        assertSessionInWorkspaceEnvironment(services, trade.sessionId);
      }
      return services.tradeAutopsy.summarize(tradeId);
    },
  );

  handle(
    ipcMain,
    channels.trades.autopsy.list,
    ipcPayloadUnknownSchema,
    async (payload) => {
      const { tradeId } = tradeIdSchema.parse(payload);
      const trade = services.repos.trades.require(tradeId);
      if (trade.sessionId) {
        assertSessionInWorkspaceEnvironment(services, trade.sessionId);
      }
      return services.tradeAutopsy.listByTrade(tradeId);
    },
  );

  handle(
    ipcMain,
    channels.trades.autopsy.listLessons,
    ipcPayloadUnknownSchema,
    async (payload) => {
      const { autopsyId } = autopsyIdSchema.parse(payload);
      return services.tradeAutopsy.listLessons(autopsyId);
    },
  );

  handle(
    ipcMain,
    channels.trades.autopsy.addLesson,
    ipcPayloadUnknownSchema,
    async (payload) => {
      const input = addLessonSchema.parse(payload) as AddLessonInput;
      assertSessionInWorkspaceEnvironment(services, input.sessionId);
      return services.tradeAutopsy.addLesson(input);
    },
  );

  handle(
    ipcMain,
    channels.trades.autopsy.updateLesson,
    ipcPayloadUnknownSchema,
    async (payload) => {
      const input = updateLessonSchema.parse(payload) as UpdateLessonInput;
      services.tradeAutopsy.updateLesson(input.lessonId, input);
      return { ok: true as const };
    },
  );

  handle(
    ipcMain,
    channels.trades.autopsy.export,
    ipcPayloadUnknownSchema,
    async (payload, event) => {
      const { autopsyId, format } = exportSchema.parse(payload) as {
        autopsyId: string;
        format: ExportFormat;
      };
      const autopsy = services.repos.autopsies.findTrade(autopsyId);
      if (!autopsy) {
        throw new AppError("Autopsy not found.", "NOT_FOUND", { autopsyId });
      }
      assertSessionInWorkspaceEnvironment(services, autopsy.sessionId);
      const trade = services.repos.trades.require(autopsy.tradeId);
      const lessons = services.tradeAutopsy.listLessons(autopsyId);
      const session = services.repos.session.get(autopsy.sessionId);
      return services.autopsyExport.export(
        format,
        autopsy,
        lessons,
        trade,
        session?.name ?? autopsy.sessionId,
        event.sender,
      );
    },
  );
}
