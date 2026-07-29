import { ipcMain } from "electron";
import { z } from "zod";
import { sessionIdParamSchema } from "@electron/shared/validation/schemas";
import { channels } from "@electron/shared/ipc/channels";
import type { AppServices } from "../../services/app-services";
import { assertSessionInWorkspaceEnvironment } from "../environment-guards";
import { handle } from "../handle";
import { ipcPayloadUnknownSchema } from "../payload-schemas";

const scanDayParamSchema = z.object({
  sessionId: z.string().min(1),
  day: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

export function registerSessionActivityHandlers(services: AppServices): void {
  handle(
    ipcMain,
    channels.sessionActivity.list,
    ipcPayloadUnknownSchema,
    async () => services.sessionActivityTracker.listSnapshots(),
  );

  handle(
    ipcMain,
    channels.sessionActivity.get,
    ipcPayloadUnknownSchema,
    async (payload) => {
      const { sessionId } = sessionIdParamSchema.parse(payload);
      assertSessionInWorkspaceEnvironment(services, sessionId);
      return services.sessionActivityTracker.getSnapshot(sessionId);
    },
  );

  handle(
    ipcMain,
    channels.sessionActivity.listTransitions,
    ipcPayloadUnknownSchema,
    async (payload) => {
      const { sessionId } = sessionIdParamSchema.parse(payload);
      assertSessionInWorkspaceEnvironment(services, sessionId);
      return services.sessionActivityTracker.listTransitions(sessionId);
    },
  );

  handle(
    ipcMain,
    channels.sessionActivity.monitoringHealth,
    ipcPayloadUnknownSchema,
    async () => services.sessionActivityTracker.getMonitoringHealth(),
  );

  handle(
    ipcMain,
    channels.sessionActivity.analytics,
    ipcPayloadUnknownSchema,
    async (payload) => {
      const { sessionId } = sessionIdParamSchema.parse(payload);
      assertSessionInWorkspaceEnvironment(services, sessionId);
      return services.sessionActivityTracker.getAnalytics(sessionId);
    },
  );

  handle(
    ipcMain,
    channels.sessionActivity.firstDivergence,
    ipcPayloadUnknownSchema,
    async (payload) => {
      const { sessionId } = sessionIdParamSchema.parse(payload);
      assertSessionInWorkspaceEnvironment(services, sessionId);
      return services.cycleFunnel.firstDivergence(sessionId);
    },
  );

  // Pre-signal half of the funnel: why the last scheduled scan never reached
  // a decision. `firstDivergence` above only covers cycles that already began.
  handle(
    ipcMain,
    channels.sessionActivity.scanFunnel,
    ipcPayloadUnknownSchema,
    async (payload) => {
      const { sessionId } = sessionIdParamSchema.parse(payload);
      assertSessionInWorkspaceEnvironment(services, sessionId);
      return services.scanFunnel.forSession(sessionId);
    },
  );

  handle(
    ipcMain,
    channels.sessionActivity.opportunityRate,
    ipcPayloadUnknownSchema,
    async (payload) => {
      const { sessionId, day } = scanDayParamSchema.parse(payload);
      assertSessionInWorkspaceEnvironment(services, sessionId);
      const dayKey = day ?? new Date().toISOString().slice(0, 10);
      return {
        sessionId,
        day: dayKey,
        ...services.opportunityRate.summarize(sessionId, dayKey),
      };
    },
  );
}
