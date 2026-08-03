import "electron-squirrel-startup";
import { app, BrowserWindow } from "electron";
import { registerIpcHandlers } from "./ipc/register";
import { createLogger } from "./services/infra/log";
import { createAppServices, type AppServices } from "./services/app-services";
import { ShutdownCoordinator } from "./services/session/shutdown-coordinator";
import { applyProcessIcon } from "./app-icon";
import { createMainWindow } from "./window";
import { env } from "./config/env";
import {
  acquireInstanceLock,
  clearInstanceLock,
  isHeadlessMode,
  type InstanceMode,
} from "./instance-lock";
import { resolveRuntimeFingerprint } from "./runtime-fingerprint";
import { recordRuntimeDiagnostic } from "./services/infra/runtime-diagnostics";

let services: AppServices | null = null;
let shutdownCoordinator: ShutdownCoordinator | null = null;
// Defer pino until after the instance lock — early createLogger + exit races
// async sonic-boom and surfaces as an uncaught "sonic boom is not ready yet".
let logger: ReturnType<typeof createLogger> | null = null;

// Product identity. Dev dock/bundle name comes from
// scripts/branding/rebrand-electron-runtime.ts (Electron.app → Exva.app).
app.setName("Exva");
if (process.platform === "darwin") {
  app.setAboutPanelOptions({
    applicationName: "Exva",
    applicationVersion: app.getVersion(),
    copyright: "Exva",
  });
}
app.disableHardwareAcceleration();

app.on("render-process-gone", (_event, webContents, details) => {
  recordRuntimeDiagnostic({
    kind: "render_process_gone",
    services,
    severity: details.reason === "oom" ? "CRITICAL" : "ERROR",
    detail: {
      webContentsId: webContents.id,
      url: webContents.getURL(),
      reason: details.reason,
      exitCode: details.exitCode,
    },
  });
});

app.on("child-process-gone", (_event, details) => {
  recordRuntimeDiagnostic({
    kind: "child_process_gone",
    services,
    severity: details.reason === "oom" ? "CRITICAL" : "ERROR",
    detail: {
      type: details.type,
      reason: details.reason,
      exitCode: details.exitCode,
      serviceName: details.serviceName ?? null,
      name: details.name ?? null,
    },
  });
});

// Last-resort: log and keep the process alive so trading state is inspectable.
// Do not rethrow — a silent crash mid-session is worse than a logged orphan.
function logFatal(kind: string, reason: unknown): void {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  if (logger) {
    logger.error({ err }, kind);
  } else {
    console.error(kind, err);
  }
  recordUnplannedStopsForActiveSessions();
}

function recordUnplannedStopsForActiveSessions(): void {
  if (!services) return;
  const active = services.repos.session
    .list({ includeArchived: false })
    .filter(
      (session) =>
        session.status === "active" || session.status === "attention_required",
    );
  for (const session of active) {
    services.sessionUptime.recordUnplannedStop(session.id);
  }
}
process.on("unhandledRejection", (reason) => {
  logFatal("unhandled promise rejection", reason);
});
process.on("uncaughtException", (error) => {
  logFatal("uncaught exception", error);
});

app.whenReady().then(async () => {
  const bootStartedAt = Date.now();
  try {
    const headless = isHeadlessMode();
    const mode: InstanceMode = headless ? "headless" : "gui";
    const lock = await acquireInstanceLock(mode);
    if (!lock.ok) {
      // Sync stderr only — pino destination may not be ready yet.
      console.error("single-instance lock refused", lock.reason);
      app.exit(1);
      return;
    }

    const bootLogger = createLogger("main");
    logger = bootLogger;
    const fingerprint = resolveRuntimeFingerprint();
    bootLogger.info(
      {
        pid: process.pid,
        headless,
        nodeEnv: env.isProd
          ? "production"
          : env.isTest
            ? "test"
            : "development",
        commitSha: fingerprint.commitSha,
        dirty: fingerprint.dirty,
        fingerprintSource: fingerprint.source,
      },
      "starting Exva main process",
    );
    services = await createAppServices(app);
    services.repos.events.insert({
      session_id: null,
      trade_id: null,
      cycle_id: null,
      level: "INFO",
      agent_type: null,
      message: `Boot fingerprint commit=${fingerprint.commitSha ?? "unknown"} dirty=${fingerprint.dirty ?? "unknown"} source=${fingerprint.source} pid=${process.pid}`,
    });
    const servicesReadyMs = Date.now() - bootStartedAt;
    shutdownCoordinator = new ShutdownCoordinator(
      services.runtimeManager,
      bootLogger,
      () => {
        clearInstanceLock();
        services?.db.sqlite.close();
      },
      () => {
        services?.stopBackgroundTickers();
      },
    );
    bootLogger.info({ servicesReadyMs }, "app services initialized");
    await seedBrokerAllocations(services);
    bootLogger.info("broker allocation seed pass complete");
    await services.runtimeManager.rehydrateFromDb();
    bootLogger.info("runtime manager rehydrated from database");
    registerIpcHandlers(services);
    bootLogger.info("ipc handlers registered");

    if (headless) {
      bootLogger.info(
        {
          coldStartMs: Date.now() - bootStartedAt,
          budgetMs: 3000,
        },
        "headless mode: skipping BrowserWindow; supervisor + nightly jobs running",
      );
    } else {
      applyProcessIcon();
      await createMainWindow(services);
      const coldStartMs = Date.now() - bootStartedAt;
      bootLogger.info(
        {
          coldStartMs,
          budgetMs: 3000,
          overBudget: coldStartMs > 3000,
        },
        "main window created (cold start: app ready → window)",
      );
    }
  } catch (error) {
    if (logger) {
      logger.error({ err: error }, "failed to start Exva");
    } else {
      console.error("failed to start Exva", error);
    }
    clearInstanceLock();
    app.quit();
    process.exit(1);
  }

  app.on("activate", () => {
    if (isHeadlessMode()) return;
    if (BrowserWindow.getAllWindows().length === 0 && services) {
      void createMainWindow(services).catch((error) => {
        logger?.error(
          { err: error },
          "failed to recreate main window on activate",
        );
      });
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
  void shutdownCoordinator
    .shutdown()
    .catch((error) => {
      logger?.error({ err: error }, "shutdown coordinator failed");
    })
    .finally(() => {
      clearInstanceLock();
      app.exit(0);
    });
});

async function seedBrokerAllocations(services: AppServices): Promise<void> {
  const log = logger!;
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
      log.warn(
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
