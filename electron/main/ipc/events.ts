import { ipcMain } from "electron";
import { eventFiltersSchema, tradeIdSchema } from "@/lib/schemas";
import { channels } from "@electron/shared/channels";
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
}
