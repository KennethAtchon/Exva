import { ipcMain } from "electron";
import {
  apiCallLogFiltersSchema,
  cycleIdSchema,
  eventFiltersSchema,
  tradeIdSchema,
} from "@/lib/schemas";
import { channels } from "@electron/shared/ipc/channels";
import type { AppServices } from "../../services/app-services";
import {
  assertSessionInWorkspaceEnvironment,
  workspaceEnvironmentSessionIds,
} from "../environment-guards";
import { handle } from "../handle";
import { ipcPayloadUnknownSchema } from "../payload-schemas";

export function registerEventHandlers(services: AppServices): void {
  handle(
    ipcMain,
    channels.events.list,
    ipcPayloadUnknownSchema,
    async (payload) => {
      const filters = eventFiltersSchema.parse(payload) ?? {};
      if (filters.sessionId) {
        assertSessionInWorkspaceEnvironment(services, filters.sessionId);
        return services.repos.events.query(filters);
      }
      const allowed = new Set(workspaceEnvironmentSessionIds(services));
      return services.repos.events
        .query(filters)
        .filter((event) => !event.session_id || allowed.has(event.session_id));
    },
  );

  handle(
    ipcMain,
    channels.events.getAgentTraces,
    ipcPayloadUnknownSchema,
    async (payload) => {
      const { tradeId } = tradeIdSchema.parse(payload);
      return services.repos.agentRuns.listByTrade(tradeId);
    },
  );

  handle(
    ipcMain,
    channels.events.getAgentTracesByCycle,
    ipcPayloadUnknownSchema,
    async (payload) => {
      const { cycleId } = cycleIdSchema.parse(payload);
      return services.repos.agentRuns.listByCycle(cycleId);
    },
  );

  handle(
    ipcMain,
    channels.events.getMessagesByCycle,
    ipcPayloadUnknownSchema,
    async (payload) => {
      const { cycleId } = cycleIdSchema.parse(payload);
      return services.repos.agentMessages.listByCycle(cycleId);
    },
  );

  handle(
    ipcMain,
    channels.events.getApiCallLog,
    ipcPayloadUnknownSchema,
    async (payload) => {
      const filters = apiCallLogFiltersSchema.parse(payload);
      return services.repos.apiCallLog.listByScope(filters);
    },
  );
}
