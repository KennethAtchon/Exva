import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ipcMain, shell } from "electron";
import { and, desc, eq, gte, inArray, like, lt, type SQL } from "drizzle-orm";
import { channels } from "@electron/shared/ipc/channels";
import type { AppServices } from "../services/app-services";
import { handle } from "./handle";
import { createLogger } from "../services/infra/log";
import {
  apiCallLog,
  agentRuns,
  developerSettings,
  events,
  runtimeLogOverrides,
  sessionExecutionSteps,
  sessions,
} from "../db/schema";

const log = createLogger("developer-ipc");

const ALLOWED_PATH_KINDS = new Set(["logsDirectory", "debugBundle"]);

function resolveLogDir(): string {
  const envDir = process.env.EXVA_LOG_DIR;
  if (envDir && envDir.trim()) return envDir.trim();
  return path.join(os.homedir(), ".exva", "logs");
}

function isAllowedPath(kind: string, filePath?: string): boolean {
  if (kind === "logsDirectory") return true;
  if (kind === "debugBundle" && filePath) {
    const bundleBase = path.join(os.homedir(), ".exva", "debug-bundles");
    return path.resolve(filePath).startsWith(bundleBase);
  }
  return false;
}

let effectiveLogLevel = process.env.LOG_LEVEL ?? "info";

function getOrCreateSettings(db: AppServices["db"]["db"]) {
  const row = db.select().from(developerSettings).where(eq(developerSettings.id, "singleton")).get();
  if (row) return row;
  const defaults = {
    id: "singleton" as const,
    defaultEventMinLevel: "INFO",
    defaultTimeWindowMinutes: 60,
    defaultSourceFiltersJson: "[]",
    includePromptsInExports: false,
    includeToolPayloadsInExports: true,
  };
  db.insert(developerSettings).values(defaults).run();
  return defaults;
}

export function registerDeveloperHandlers(services: AppServices): void {
  const drizzle = services.db.db;

  handle(ipcMain, channels.developer.getSettings, async () => {
    const settings = getOrCreateSettings(drizzle);
    const now = new Date().toISOString();
    const allOverrides = drizzle.select().from(runtimeLogOverrides)
      .orderBy(desc(runtimeLogOverrides.createdAt)).all();
    const activeOverrides = allOverrides.filter(o => !o.expiresAt || o.expiresAt > now);

    return {
      settings: {
        defaultEventMinLevel: settings.defaultEventMinLevel,
        defaultTimeWindowMinutes: settings.defaultTimeWindowMinutes,
        defaultSourceFilters: JSON.parse(settings.defaultSourceFiltersJson ?? "[]") as string[],
        includePromptsInExports: settings.includePromptsInExports,
        includeToolPayloadsInExports: settings.includeToolPayloadsInExports,
      },
      effectiveLogLevel,
      activeOverrides,
      logDirectory: resolveLogDir(),
    };
  });

  handle(ipcMain, channels.developer.updateSettings, async (payload) => {
    const p = payload as {
      defaultEventMinLevel?: string;
      defaultTimeWindowMinutes?: number;
      defaultSourceFilters?: string[];
      includePromptsInExports?: boolean;
      includeToolPayloadsInExports?: boolean;
    };
    getOrCreateSettings(drizzle);
    const patch: Record<string, unknown> = {};
    if (p.defaultEventMinLevel != null) patch["defaultEventMinLevel"] = p.defaultEventMinLevel;
    if (p.defaultTimeWindowMinutes != null) patch["defaultTimeWindowMinutes"] = p.defaultTimeWindowMinutes;
    if (p.defaultSourceFilters != null) patch["defaultSourceFiltersJson"] = JSON.stringify(p.defaultSourceFilters);
    if (p.includePromptsInExports != null) patch["includePromptsInExports"] = p.includePromptsInExports;
    if (p.includeToolPayloadsInExports != null) patch["includeToolPayloadsInExports"] = p.includeToolPayloadsInExports;
    if (Object.keys(patch).length > 0) {
      drizzle.update(developerSettings).set(patch).where(eq(developerSettings.id, "singleton")).run();
    }
    return { settings: getOrCreateSettings(drizzle) };
  });

  handle(ipcMain, channels.developer.setLogLevel, async (payload) => {
    const p = payload as {
      scopeType: string;
      scopeId?: string;
      mainLogLevel: string;
      eventMinLevel: string;
      durationMinutes?: number;
      untilStopped?: boolean;
    };

    const overrideId = crypto.randomUUID();
    const now = new Date().toISOString();
    let expiresAt: string | null = null;
    if (!p.untilStopped && p.durationMinutes) {
      expiresAt = new Date(Date.now() + p.durationMinutes * 60 * 1000).toISOString();
    }

    drizzle.insert(runtimeLogOverrides).values({
      id: overrideId,
      scopeType: p.scopeType,
      scopeId: p.scopeId ?? null,
      mainLogLevel: p.mainLogLevel,
      eventMinLevel: p.eventMinLevel,
      expiresAt,
      createdAt: now,
    }).run();

    if (p.scopeType === "global") {
      effectiveLogLevel = p.mainLogLevel;
      log.info({ level: p.mainLogLevel }, "Log level override applied");
    }

    if (expiresAt) {
      const ms = new Date(expiresAt).getTime() - Date.now();
      setTimeout(() => {
        try {
          drizzle.delete(runtimeLogOverrides).where(eq(runtimeLogOverrides.id, overrideId)).run();
          effectiveLogLevel = process.env.LOG_LEVEL ?? "info";
          log.info({ overrideId }, "Debug capture expired, log level restored");
        } catch {}
      }, ms);
    }

    return { overrideId, effectiveLogLevel, expiresAt };
  });

  handle(ipcMain, channels.developer.stopLogOverride, async (payload) => {
    const p = payload as { overrideId: string };
    drizzle.delete(runtimeLogOverrides).where(eq(runtimeLogOverrides.id, p.overrideId)).run();
    effectiveLogLevel = process.env.LOG_LEVEL ?? "info";
    return { stopped: true as const, effectiveLogLevel };
  });

  handle(ipcMain, channels.developer.getScopeDiagnostics, async (payload) => {
    const p = payload as { scope: { type: string; id?: string } };
    const { scope } = p;

    let sessionRow: typeof sessions.$inferSelect | null = null;
    let activeCycleId: string | null = null;
    let executionProgress: object | null = null;
    let pipelineConfig: unknown = null;
    let pipelineConfigError: string | null = null;

    if (scope.type === "session" && scope.id) {
      sessionRow = drizzle.select().from(sessions).where(eq(sessions.id, scope.id)).get() ?? null;

      const steps = drizzle.select().from(sessionExecutionSteps)
        .where(eq(sessionExecutionSteps.sessionId, scope.id))
        .orderBy(desc(sessionExecutionSteps.updatedAt))
        .limit(20).all();

      if (steps.length > 0) {
        activeCycleId = steps[0].cycleId ?? null;
        executionProgress = {
          steps: steps.map(s => ({
            stage: s.stage,
            status: s.status,
            attempt: s.attempt,
            nextRetryAt: s.nextRetryAt,
            lastErrorCode: s.lastErrorCode,
            lastErrorMessage: s.lastErrorMessage,
            retryable: s.retryable,
          })),
          cycleId: activeCycleId,
        };
      }

      try {
        pipelineConfig = services.ai.assertValidEffectivePipelineConfig(scope.id);
      } catch (error) {
        pipelineConfigError = error instanceof Error ? error.message : String(error);
        try {
          pipelineConfig = services.ai.resolveEffectivePipelineConfig(scope.id);
        } catch {
          pipelineConfig = null;
        }
      }
    }

    const windowStart = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const scopedEvents = scope.type === "session" && scope.id
      ? drizzle.select().from(events)
          .where(and(eq(events.sessionId, scope.id), gte(events.createdAt, windowStart)))
          .limit(500).all()
      : drizzle.select().from(events).where(gte(events.createdAt, windowStart)).limit(500).all();

    const errorCount = scopedEvents.filter(e => e.level === "ERROR").length;
    const warnCount = scopedEvents.filter(e => e.level === "WARN").length;

    const runCount = scope.type === "session" && scope.id
      ? drizzle.select().from(agentRuns).where(eq(agentRuns.sessionId, scope.id)).all().length
      : 0;

    const callCount = scope.type === "session" && scope.id
      ? drizzle.select().from(apiCallLog).where(eq(apiCallLog.sessionId, scope.id)).all().length
      : 0;

    const failedStepCount = scope.type === "session" && scope.id
      ? drizzle.select().from(sessionExecutionSteps)
          .where(and(eq(sessionExecutionSteps.sessionId, scope.id), eq(sessionExecutionSteps.status, "failed")))
          .all().length
      : 0;

    const latestError = scopedEvents.find(e => e.level === "ERROR");

    return {
      scopeLabel: scope.type === "global"
        ? "Global workspace"
        : `${scope.type}: ${sessionRow?.name ?? scope.id ?? ""}`,
      session: sessionRow
        ? { id: sessionRow.id, name: sessionRow.name, status: sessionRow.status, executionMode: sessionRow.executionMode, isFocused: sessionRow.isFocused }
        : null,
      activeCycleId,
      executionProgress: executionProgress ?? undefined,
      pipelineConfig,
      pipelineConfigError,
      counts: { events: scopedEvents.length, errors: errorCount, warnings: warnCount, agentRuns: runCount, externalCalls: callCount, failedSteps: failedStepCount },
      latestError: latestError
        ? { message: latestError.message, createdAt: latestError.createdAt, eventId: latestError.id }
        : null,
    };
  });

  handle(ipcMain, channels.developer.exportDebugBundle, async (payload) => {
    const p = payload as { scope: { type: string; id?: string }; includePrompts: boolean; includeToolPayloads: boolean; timeWindowMinutes: number };
    const now = new Date();
    const windowStart = p.timeWindowMinutes > 0
      ? new Date(now.getTime() - p.timeWindowMinutes * 60 * 1000).toISOString()
      : "1970-01-01T00:00:00.000Z";

    const scopedEvents = p.scope.type === "session" && p.scope.id
      ? drizzle.select().from(events).where(and(eq(events.sessionId, p.scope.id), gte(events.createdAt, windowStart))).all()
      : drizzle.select().from(events).where(gte(events.createdAt, windowStart)).limit(1000).all();

    const scopedRuns = p.scope.type === "session" && p.scope.id
      ? drizzle.select().from(agentRuns).where(eq(agentRuns.sessionId, p.scope.id)).all()
      : [];

    const scopedCalls = p.scope.type === "session" && p.scope.id
      ? drizzle.select().from(apiCallLog).where(eq(apiCallLog.sessionId, p.scope.id)).all()
      : [];

    const settings = getOrCreateSettings(drizzle);
    const REDACT_KEYS = new Set(["api_key", "apiKey", "secret_key", "secretKey", "authorization", "password", "token", "secret"]);
    let redactionCount = 0;

    function redactObj(obj: unknown): unknown {
      if (typeof obj !== "object" || obj === null) return obj;
      if (Array.isArray(obj)) return obj.map(redactObj);
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
        if (REDACT_KEYS.has(k)) { out[k] = "[REDACTED]"; redactionCount++; }
        else { out[k] = redactObj(v); }
      }
      return out;
    }

    const bundle = {
      exportedAt: now.toISOString(),
      scope: p.scope,
      timeWindowMinutes: p.timeWindowMinutes,
      events: redactObj(scopedEvents),
      agentRuns: redactObj(scopedRuns),
      externalCalls: redactObj(scopedCalls),
      settings: { defaultEventMinLevel: settings.defaultEventMinLevel, defaultTimeWindowMinutes: settings.defaultTimeWindowMinutes },
    };

    const bundleDir = path.join(os.homedir(), ".exva", "debug-bundles");
    fs.mkdirSync(bundleDir, { recursive: true });
    const filename = `debug-${now.toISOString().replace(/[:.]/g, "-")}.json`;
    const bundlePath = path.join(bundleDir, filename);
    const bundleJson = JSON.stringify(bundle, null, 2);
    fs.writeFileSync(bundlePath, bundleJson, "utf8");

    const sizeBytes = Buffer.byteLength(bundleJson, "utf8");
    const warnings: string[] = [];
    if (sizeBytes > 25 * 1024 * 1024) warnings.push("Bundle exceeds 25 MB. Consider narrowing scope or time window.");

    return { path: bundlePath, sizeBytes, includedSections: ["events", "agentRuns", "externalCalls", "settings"], redactionCount, warnings };
  });

  handle(ipcMain, channels.developer.openPath, async (payload) => {
    const p = payload as { kind: string; path?: string };

    if (!ALLOWED_PATH_KINDS.has(p.kind)) throw new Error("Path is not allowed.");
    if (!isAllowedPath(p.kind, p.path)) throw new Error("Path is not allowed.");

    if (p.kind === "logsDirectory") {
      const logDir = resolveLogDir();
      if (!fs.existsSync(logDir)) throw new Error("Log folder is not available yet.");
      await shell.openPath(logDir);
    } else if (p.kind === "debugBundle" && p.path) {
      shell.showItemInFolder(p.path);
    }

    return { opened: true as const };
  });

  handle(ipcMain, channels.developer.listEventsV2, async (payload) => {
    const p = payload as {
      scope?: { type: string; id?: string };
      minLevel?: string;
      sourceTypes?: string[];
      search?: string;
      timeWindowMinutes?: number;
      cursor?: string | null;
      limit: number;
    };

    const clampedLimit = Math.min(p.limit ?? 100, 200);
    const twMin = p.timeWindowMinutes ?? 60;
    const windowStart = twMin > 0
      ? new Date(Date.now() - twMin * 60 * 1000).toISOString()
      : "1970-01-01T00:00:00.000Z";

    const LEVEL_ORDER: Record<string, number> = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
    const minOrd = p.minLevel ? (LEVEL_ORDER[p.minLevel] ?? 0) : 0;
    const allowedLevels = Object.entries(LEVEL_ORDER)
      .filter(([, ord]) => ord >= minOrd)
      .map(([l]) => l);

    const conditions: SQL[] = [gte(events.createdAt, windowStart)];

    if (p.scope?.type === "session" && p.scope.id) {
      conditions.push(eq(events.sessionId, p.scope.id));
    }
    if (allowedLevels.length < 4) {
      conditions.push(inArray(events.level, allowedLevels));
    }
    if (p.sourceTypes && p.sourceTypes.length > 0) {
      conditions.push(inArray(events.agentType, p.sourceTypes));
    }
    if (p.search) {
      conditions.push(like(events.message, `%${p.search}%`));
    }
    if (p.cursor) {
      conditions.push(lt(events.createdAt, p.cursor));
    }

    const t0 = Date.now();
    const rows = drizzle.select().from(events)
      .where(and(...conditions))
      .orderBy(desc(events.createdAt))
      .limit(clampedLimit + 1)
      .all();

    const queryMs = Date.now() - t0;
    const hasMore = rows.length > clampedLimit;
    const page = rows.slice(0, clampedLimit);
    const nextCursor = hasMore ? (page[page.length - 1]?.createdAt ?? null) : null;

    return { events: page, nextCursor, queryMs };
  });
}
