import "electron-squirrel-startup";
import { app, BrowserWindow } from "electron";
import { registerIpcHandlers } from "./ipc/register";
import { createLogger } from "./services/infra/log";
import { createAppServices, type AppServices } from "./services/app-services";
import { ShutdownCoordinator } from "./services/session/shutdown-coordinator";
import { createMainWindow } from "./window";
import { env } from "./config/env";
import {
  acquireInstanceLock,
  clearInstanceLock,
  isHeadlessMode,
  type InstanceMode,
} from "./instance-lock";

let services: AppServices | null = null;
let shutdownCoordinator: ShutdownCoordinator | null = null;
const logger = createLogger("main");

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const bootStartedAt = Date.now();
  try {
    const headless = isHeadlessMode();
    const mode: InstanceMode = headless ? "headless" : "gui";
    const lock = await acquireInstanceLock(mode);
    if (!lock.ok) {
      logger.error({ reason: lock.reason }, "single-instance lock refused");
      app.exit(1);
      return;
    }

    logger.info(
      {
        pid: process.pid,
        headless,
        nodeEnv: env.isProd
          ? "production"
          : env.isTest
            ? "test"
            : "development",
      },
      "starting Exva main process",
    );
    services = await createAppServices(app);
    const servicesReadyMs = Date.now() - bootStartedAt;
    shutdownCoordinator = new ShutdownCoordinator(
      services.runtimeManager,
      logger,
      () => {
        clearInstanceLock();
        services?.db.sqlite.close();
      },
      () => {
        services?.stopBackgroundTickers();
      },
    );
    logger.info({ servicesReadyMs }, "app services initialized");
    await seedBrokerAllocations(services);
    logger.info("broker allocation seed pass complete");
    await services.runtimeManager.rehydrateFromDb();
    logger.info("runtime manager rehydrated from database");
    registerIpcHandlers(services);
    logger.info("ipc handlers registered");

    if (headless) {
      logger.info(
        {
          coldStartMs: Date.now() - bootStartedAt,
          budgetMs: 3000,
        },
        "headless mode: skipping BrowserWindow; supervisor + nightly jobs running",
      );
    } else {
      await createMainWindow(services);
      const coldStartMs = Date.now() - bootStartedAt;
      logger.info(
        {
          coldStartMs,
          budgetMs: 3000,
          overBudget: coldStartMs > 3000,
        },
        "main window created (cold start: app ready → window)",
      );
    }
  } catch (error) {
    logger.error({ err: error }, "failed to start Exva");
    clearInstanceLock();
    app.quit();
    process.exit(1);
  }

  app.on("activate", () => {
    if (isHeadlessMode()) return;
    if (BrowserWindow.getAllWindows().length === 0 && services) {
      void createMainWindow(services);
    }
  });
});

app.on("window-all-closed", () => {
  // Headless has no windows — never quit on this event.
  if (isHeadlessMode()) return;
  app.quit();
});

app.on("will-quit", (event) => {
  if (!shutdownCoordinator || !services) {
    clearInstanceLock();
    return;
  }
  event.preventDefault();
  void shutdownCoordinator.shutdown().finally(() => {
    clearInstanceLock();
    app.exit(0);
  });
});

async function seedBrokerAllocations(services: AppServices): Promise<void> {
  const allAssignments = services.repos.sessionBrokerAssignments.listAll();
  for (const assignment of allAssignments) {
    if (assignment.allocatedUsd > 0) continue;
    try {
      const adapter = await services.brokerRegistry.get(
        assignment.brokerAccountId,
      );
      const balance = await adapter.getAccountBalance();
      const allocatedUsd = Math.floor(balance * 0.5);
      services.repos.sessionBrokerAssignments.setAllocatedUsd(
        assignment.sessionId,
        assignment.brokerAccountId,
        allocatedUsd,
      );
      services.repos.brokerAccounts.updateBalanceCache(
        assignment.brokerAccountId,
        balance,
        new Date().toISOString(),
      );
    } catch (error) {
      logger.warn(
        {
          sessionId: assignment.sessionId,
          brokerAccountId: assignment.brokerAccountId,
          error: error instanceof Error ? error.message : String(error),
        },
        "broker allocation seed skipped for assignment",
      );
    }
  }
}
