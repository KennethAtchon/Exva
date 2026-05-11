import "electron-squirrel-startup";
import { app, BrowserWindow } from "electron";
import { registerIpcHandlers } from "./ipc/register";
import { createLogger } from "./services/infra/log";
import { createAppServices, type AppServices } from "./services/app-services";
import { createMainWindow } from "./window";
import { env } from "./config/env";

let services: AppServices | null = null;
const logger = createLogger("main");

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  try {
    logger.info({ pid: process.pid, nodeEnv: env.isProd ? "production" : env.isTest ? "test" : "development" }, "starting Exva main process");
    services = await createAppServices(app);
    logger.info("app services initialized");
    await services.runtimeManager.rehydrateFromDb();
    logger.info("runtime manager rehydrated from database");
    registerIpcHandlers(services);
    logger.info("ipc handlers registered");
    await createMainWindow(services);
    logger.info("main window created");
  } catch (error) {
    logger.error({ err: error }, "failed to start Exva");
    app.quit();
    process.exit(1);
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0 && services) {
      void createMainWindow(services);
    }
  });
});

app.on("window-all-closed", () => {
  app.quit();
});

app.on("before-quit", () => {
  services?.db.sqlite.close();
});
