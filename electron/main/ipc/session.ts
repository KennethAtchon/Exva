import { ipcMain } from "electron";
import { channels } from "@electron/shared/channels";
import type { AppServices } from "../services/app-services";
import { handle } from "./handle";

export function registerSessionHandlers(services: AppServices): void {
  handle(ipcMain, channels.session.start, async () => services.session.start());
  handle(ipcMain, channels.session.pause, async () => services.session.pause());
  handle(ipcMain, channels.session.resume, async () => services.session.resume());
  handle(ipcMain, channels.session.stop, async () => services.session.stop());
  handle(ipcMain, channels.session.getStatus, async () => services.session.getStatus());
}
