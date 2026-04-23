import "electron-squirrel-startup";
import { app, BrowserWindow } from "electron";
import { logger } from "@electron/shared/logger";
import { registerIpcHandlers } from "./ipc/register";
import { createAppServices, type AppServices } from "./services/app-services";
import { createMainWindow } from "./window";

let services: AppServices | null = null;

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  try {
    services = await createAppServices(app);
    registerIpcHandlers(services);
    await createMainWindow(services);
  } catch (error) {
    logger.error({ err: error }, "failed to start Exva");
    app.quit();
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0 && services) {
      void createMainWindow(services);
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  services?.monitor.stop();
  services?.db.sqlite.close();
});
