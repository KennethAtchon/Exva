import { ipcMain } from "electron";
import {
  apiCallLogFiltersSchema,
  cycleIdSchema,
  eventFiltersSchema,
  tradeIdSchema,
} from "@/lib/schemas";
import { channels } from "@electron/shared/ipc/channels";
import type { AppServices } from "../services/app-services";
import { handle } from "./handle";

export function registerEventHandlers(services: AppServices): void {
  handle(ipcMain, channels.events.list, async (payload) => {
    const filters = eventFiltersSchema.parse(payload);
    return services.repos.events.query(filters);
  });

  handle(ipcMain, channels.events.getAgentTraces, async (payload) => {
    const { tradeId } = tradeIdSchema.parse(payload);
    return services.repos.agentRuns.listByTrade(tradeId);
  });

  handle(ipcMain, channels.events.getAgentTracesByCycle, async (payload) => {
    const { cycleId } = cycleIdSchema.parse(payload);
    return services.repos.agentRuns.listByCycle(cycleId);
  });

  handle(ipcMain, channels.events.getMessagesByCycle, async (payload) => {
    const { cycleId } = cycleIdSchema.parse(payload);
    return services.repos.agentMessages.listByCycle(cycleId);
  });

  handle(ipcMain, channels.events.getApiCallLog, async (payload) => {
    const filters = apiCallLogFiltersSchema.parse(payload);
    return services.repos.apiCallLog.listByScope(filters);
  });
}
