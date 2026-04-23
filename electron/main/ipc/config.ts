import { ipcMain } from "electron";
import { sessionConfigSchema } from "@/lib/schemas";
import { channels } from "@electron/shared/channels";
import type { AppServices } from "../services/app-services";
import { handle } from "./handle";

export function registerConfigHandlers(services: AppServices): void {
  handle(ipcMain, channels.config.getStrategy, async () => services.repos.session.getConfig());

  handle(ipcMain, channels.config.saveStrategy, async (payload) => {
    const cfg = sessionConfigSchema.parse(payload);
    services.repos.session.saveConfig(cfg);
  });
}
