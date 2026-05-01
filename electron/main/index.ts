import "electron-squirrel-startup";
import { app, BrowserWindow } from "electron";
import { registerIpcHandlers } from "./ipc/register";
import { createLogger } from "./services/log";
import { createAppServices, type AppServices } from "./services/app-services";
import { createMainWindow } from "./window";

let services: AppServices | null = null;
const logger = createLogger("main");

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  try {
    services = await createAppServices(app);
    await services.runtimeManager.rehydrateFromDb();
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
  services?.db.sqlite.close();
});
