import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { ipcMain, shell } from "electron";
import { and, desc, eq, gte, inArray, like, lt, type SQL } from "drizzle-orm";
import { channels } from "@electron/shared/ipc/channels";
import { z } from "zod";
import type { AppServices } from "../../services/app-services";
import { handle } from "../handle";
import {
  ipcNoPayloadSchema,
  ipcPayloadUnknownSchema,
} from "../payload-schemas";
import {
  createLogger,
  getRuntimeLogLevel,
  LOG_LEVELS,
  resetRuntimeLogLevel,
  setRuntimeLogLevel,
  type LogLevel as PinoLogLevel,
} from "../../services/infra/log";
import { safeJsonParse } from "../../services/infra/safe-json-parse";
import { env } from "../../config/env";
import {
  apiCallLog,
  agentMessages,
  agentRuns,
  decisionTraces,
  developerSettings,
  events,
  runtimeLogOverrides,
  scheduleRuntimeStates,
  sessionExecutionSteps,
  signalSourcePolls,
  signalSourceRuntimeStates,
  sessions,
  tradeApprovals,
  trades,
} from "../../db/schema";
import { resolveRuntimeFingerprint } from "../../runtime-fingerprint";
import { getBootId } from "../../services/infra/telemetry-context";

const log = createLogger("developer-ipc");

const ALLOWED_PATH_KINDS = new Set(["logsDirectory", "debugBundle"]);

function resolveLogDir(): string {
  const envDir = env.logDir;
  if (envDir && envDir.trim()) return envDir.trim();
  return path.join(os.homedir(), ".exva", "logs");
}

function isAllowedPath(kind: string, filePath?: string): boolean {
  if (kind === "logsDirectory") return true;
  if (kind === "debugBundle" && filePath) {
    const bundleBase = path.join(os.homedir(), ".exva", "debug-bundles");
    const relative = path.relative(bundleBase, path.resolve(filePath));
    return (
      relative.length > 0 &&
      !relative.startsWith("..") &&
      !path.isAbsolute(relative)
    );
  }
  return false;
}

let overrideTimer: ReturnType<typeof setTimeout> | null = null;

const setLogLevelSchema = z
  .object({
    scopeType: z.literal("global"),
    mainLogLevel: z.enum(LOG_LEVELS),
    eventMinLevel: z.string().optional(),
    durationMinutes: z.number().int().min(1).max(1440).optional(),
    untilStopped: z.boolean().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!value.untilStopped && value.durationMinutes == null) {
      ctx.addIssue({
        code: "custom",
        path: ["durationMinutes"],
        message: "Timed overrides require durationMinutes",
      });
    }
  });

const stopLogOverrideSchema = z
  .object({ overrideId: z.string().uuid() })
  .strict();

const debugBundleScopeSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("global"), id: z.never().optional() }).strict(),
  z
    .object({
      type: z.enum(["session", "cycle", "trade", "provider", "broker"]),
      id: z.string().min(1).max(200),
    })
    .strict(),
]);

const exportDebugBundleSchema = z
  .object({
    scope: debugBundleScopeSchema,
    includePrompts: z.boolean(),
    includeToolPayloads: z.boolean(),
    timeWindowMinutes: z.number().int().min(1).max(10_080),
  })
  .strict();

function getOrCreateSettings(db: AppServices["db"]["db"]) {
  const row = db
    .select()
    .from(developerSettings)
    .where(eq(developerSettings.id, "singleton"))
    .get();
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
  const reconcileOverride = ():
    | typeof runtimeLogOverrides.$inferSelect
    | null => {
    if (overrideTimer) clearTimeout(overrideTimer);
    overrideTimer = null;
    const now = Date.now();
    const rows = drizzle
      .select()
      .from(runtimeLogOverrides)
      .orderBy(desc(runtimeLogOverrides.createdAt))
      .all();
    for (const row of rows) {
      if (row.expiresAt && Date.parse(row.expiresAt) <= now) {
        drizzle
          .delete(runtimeLogOverrides)
          .where(eq(runtimeLogOverrides.id, row.id))
          .run();
      }
    }
    const active = rows.find(
      (row) =>
        row.scopeType === "global" &&
        (!row.expiresAt || Date.parse(row.expiresAt) > now),
    );
    if (!active || !LOG_LEVELS.includes(active.mainLogLevel as PinoLogLevel)) {
      resetRuntimeLogLevel();
      return null;
    }
    setRuntimeLogLevel(active.mainLogLevel as PinoLogLevel);
    if (active.expiresAt) {
      const delay = Math.max(0, Date.parse(active.expiresAt) - now);
      overrideTimer = setTimeout(() => {
        reconcileOverride();
        log.info(
          { eventName: "logging.override.expired", overrideId: active.id },
          "runtime log override expired",
        );
      }, delay);
    }
    return active;
  };

  reconcileOverride();

  handle(
    ipcMain,
    channels.developer.getSettings,
    ipcNoPayloadSchema,
    async () => {
      reconcileOverride();
      const settings = getOrCreateSettings(drizzle);
      const now = new Date().toISOString();
      const allOverrides = drizzle
        .select()
        .from(runtimeLogOverrides)
        .orderBy(desc(runtimeLogOverrides.createdAt))
        .all();
      const activeOverrides = allOverrides.filter(
        (o) => !o.expiresAt || o.expiresAt > now,
      );

      return {
        settings: {
          defaultEventMinLevel: settings.defaultEventMinLevel,
          defaultTimeWindowMinutes: settings.defaultTimeWindowMinutes,
          defaultSourceFilters:
            safeJsonParse<string[]>(
              settings.defaultSourceFiltersJson ?? "[]",
              undefined,
              "developer.defaultSourceFilters",
            ) ?? [],
          includePromptsInExports: settings.includePromptsInExports,
          includeToolPayloadsInExports: settings.includeToolPayloadsInExports,
        },
        effectiveLogLevel: getRuntimeLogLevel(),
        activeOverrides,
        logDirectory: resolveLogDir(),
      };
    },
  );

  handle(
    ipcMain,
    channels.developer.updateSettings,
    ipcPayloadUnknownSchema,
    async (payload) => {
      const p = payload as {
        defaultEventMinLevel?: string;
        defaultTimeWindowMinutes?: number;
        defaultSourceFilters?: string[];
        includePromptsInExports?: boolean;
        includeToolPayloadsInExports?: boolean;
      };
      getOrCreateSettings(drizzle);
      const patch: Record<string, unknown> = {};
      if (p.defaultEventMinLevel != null)
        patch["defaultEventMinLevel"] = p.defaultEventMinLevel;
      if (p.defaultTimeWindowMinutes != null)
        patch["defaultTimeWindowMinutes"] = p.defaultTimeWindowMinutes;
      if (p.defaultSourceFilters != null)
        patch["defaultSourceFiltersJson"] = JSON.stringify(
          p.defaultSourceFilters,
        );
      if (p.includePromptsInExports != null)
        patch["includePromptsInExports"] = p.includePromptsInExports;
      if (p.includeToolPayloadsInExports != null)
        patch["includeToolPayloadsInExports"] = p.includeToolPayloadsInExports;
      if (Object.keys(patch).length > 0) {
        drizzle
          .update(developerSettings)
          .set(patch)
          .where(eq(developerSettings.id, "singleton"))
          .run();
      }
      return { settings: getOrCreateSettings(drizzle) };
    },
  );

  handle(
    ipcMain,
    channels.developer.setLogLevel,
    setLogLevelSchema,
    async (payload) => {
      const p = payload;

      const overrideId = crypto.randomUUID();
      const now = new Date().toISOString();
      let expiresAt: string | null = null;
      if (!p.untilStopped && p.durationMinutes) {
        expiresAt = new Date(
          Date.now() + p.durationMinutes * 60 * 1000,
        ).toISOString();
      }

      drizzle.transaction((tx) => {
        tx.delete(runtimeLogOverrides).run();
        tx.insert(runtimeLogOverrides)
          .values({
            id: overrideId,
            scopeType: "global",
            scopeId: null,
            mainLogLevel: p.mainLogLevel,
            eventMinLevel: p.eventMinLevel ?? "DEBUG",
            expiresAt,
            createdAt: now,
          })
          .run();
      });
      reconcileOverride();
      log.info(
        {
          eventName: "logging.override.applied",
          level: p.mainLogLevel,
          overrideId,
          expiresAt,
        },
        "runtime log override applied",
      );
      return {
        overrideId,
        effectiveLogLevel: getRuntimeLogLevel(),
        expiresAt,
      };
    },
  );

  handle(
    ipcMain,
    channels.developer.stopLogOverride,
    stopLogOverrideSchema,
    async (payload) => {
      const p = payload as { overrideId: string };
      drizzle
        .delete(runtimeLogOverrides)
        .where(eq(runtimeLogOverrides.id, p.overrideId))
        .run();
      reconcileOverride();
      return {
        stopped: true as const,
        effectiveLogLevel: getRuntimeLogLevel(),
      };
    },
  );

  handle(
    ipcMain,
    channels.developer.getScopeDiagnostics,
    ipcPayloadUnknownSchema,
    async (payload) => {
      const p = payload as { scope: { type: string; id?: string } };
      const { scope } = p;

      let sessionRow: typeof sessions.$inferSelect | null = null;
      let activeCycleId: string | null = null;
      let executionProgress: object | null = null;
      let pipelineConfig: unknown = null;
      let pipelineConfigError: string | null = null;

      if (scope.type === "session" && scope.id) {
        sessionRow =
          drizzle
            .select()
            .from(sessions)
            .where(eq(sessions.id, scope.id))
            .get() ?? null;

        const steps = drizzle
          .select()
          .from(sessionExecutionSteps)
          .where(eq(sessionExecutionSteps.sessionId, scope.id))
          .orderBy(desc(sessionExecutionSteps.updatedAt))
          .limit(20)
          .all();

        if (steps.length > 0) {
          activeCycleId = steps[0].cycleId ?? null;
          executionProgress = {
            steps: steps.map((s) => ({
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
          pipelineConfig = services.ai.assertValidEffectivePipelineConfig(
            scope.id,
          );
        } catch (error) {
          pipelineConfigError =
            error instanceof Error ? error.message : String(error);
          try {
            pipelineConfig = services.ai.resolveEffectivePipelineConfig(
              scope.id,
            );
          } catch {
            pipelineConfig = null;
          }
        }
      }

      const windowStart = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const scopedEvents =
        scope.type === "session" && scope.id
          ? drizzle
              .select()
              .from(events)
              .where(
                and(
                  eq(events.sessionId, scope.id),
                  gte(events.createdAt, windowStart),
                ),
              )
              .limit(500)
              .all()
          : drizzle
              .select()
              .from(events)
              .where(gte(events.createdAt, windowStart))
              .limit(500)
              .all();

      const errorCount = scopedEvents.filter((e) => e.level === "ERROR").length;
      const warnCount = scopedEvents.filter((e) => e.level === "WARN").length;

      const runCount =
        scope.type === "session" && scope.id
          ? drizzle
              .select()
              .from(agentRuns)
              .where(eq(agentRuns.sessionId, scope.id))
              .all().length
          : 0;

      const callCount =
        scope.type === "session" && scope.id
          ? drizzle
              .select()
              .from(apiCallLog)
              .where(eq(apiCallLog.sessionId, scope.id))
              .all().length
          : 0;

      const failedStepCount =
        scope.type === "session" && scope.id
          ? drizzle
              .select()
              .from(sessionExecutionSteps)
              .where(
                and(
                  eq(sessionExecutionSteps.sessionId, scope.id),
                  eq(sessionExecutionSteps.status, "failed"),
                ),
              )
              .all().length
          : 0;

      const latestError = scopedEvents.find((e) => e.level === "ERROR");

      return {
        scopeLabel:
          scope.type === "global"
            ? "Global workspace"
            : `${scope.type}: ${sessionRow?.name ?? scope.id ?? ""}`,
        session: sessionRow
          ? {
              id: sessionRow.id,
              name: sessionRow.name,
              status: sessionRow.status,
              executionMode: sessionRow.executionMode,
              isFocused: sessionRow.isFocused,
            }
          : null,
        activeCycleId,
        executionProgress: executionProgress ?? undefined,
        pipelineConfig,
        pipelineConfigError,
        counts: {
          events: scopedEvents.length,
          errors: errorCount,
          warnings: warnCount,
          agentRuns: runCount,
          externalCalls: callCount,
          failedSteps: failedStepCount,
        },
        latestError: latestError
          ? {
              message: latestError.message,
              createdAt: latestError.createdAt,
              eventId: latestError.id,
            }
          : null,
      };
    },
  );

  handle(
    ipcMain,
    channels.developer.exportDebugBundle,
    exportDebugBundleSchema,
    async (payload) => {
      const p = payload;
      const now = new Date();
      const windowStart = new Date(
        now.getTime() - p.timeWindowMinutes * 60 * 1000,
      ).toISOString();

      const scopedEvents =
        p.scope.type === "session" && p.scope.id
          ? drizzle
              .select()
              .from(events)
              .where(
                and(
                  eq(events.sessionId, p.scope.id),
                  gte(events.createdAt, windowStart),
                ),
              )
              .orderBy(desc(events.createdAt))
              .limit(1000)
              .all()
          : drizzle
              .select()
              .from(events)
              .where(gte(events.createdAt, windowStart))
              .orderBy(desc(events.createdAt))
              .limit(1000)
              .all();

      const scopedRuns = drizzle
        .select({
          id: agentRuns.id,
          sessionId: agentRuns.sessionId,
          tradeId: agentRuns.tradeId,
          agentType: agentRuns.agentType,
          model: agentRuns.model,
          providerKey: agentRuns.providerKey,
          finishReason: agentRuns.finishReason,
          inputTokens: agentRuns.inputTokens,
          outputTokens: agentRuns.outputTokens,
          costUsd: agentRuns.costUsd,
          durationMs: agentRuns.durationMs,
          createdAt: agentRuns.createdAt,
        })
        .from(agentRuns)
        .where(
          and(
            gte(agentRuns.createdAt, windowStart),
            ...(p.scope.type === "session" && p.scope.id
              ? [eq(agentRuns.sessionId, p.scope.id)]
              : []),
          ),
        )
        .orderBy(desc(agentRuns.createdAt))
        .limit(500)
        .all();

      const scopedCalls = drizzle
        .select()
        .from(apiCallLog)
        .where(
          and(
            gte(apiCallLog.createdAt, windowStart),
            ...(p.scope.type === "session" && p.scope.id
              ? [eq(apiCallLog.sessionId, p.scope.id)]
              : []),
          ),
        )
        .orderBy(desc(apiCallLog.createdAt))
        .limit(500)
        .all();

      const scopedSteps = drizzle
        .select()
        .from(sessionExecutionSteps)
        .where(
          and(
            gte(sessionExecutionSteps.createdAt, windowStart),
            ...(p.scope.type === "session" && p.scope.id
              ? [eq(sessionExecutionSteps.sessionId, p.scope.id)]
              : []),
          ),
        )
        .orderBy(desc(sessionExecutionSteps.createdAt))
        .limit(500)
        .all();

      const scopedDecisions = drizzle
        .select()
        .from(decisionTraces)
        .where(
          and(
            gte(decisionTraces.createdAt, windowStart),
            ...(p.scope.type === "session" && p.scope.id
              ? [eq(decisionTraces.sessionId, p.scope.id)]
              : []),
          ),
        )
        .orderBy(desc(decisionTraces.createdAt))
        .limit(500)
        .all();

      const scopedTrades = drizzle
        .select()
        .from(trades)
        .where(
          and(
            gte(trades.createdAt, windowStart),
            ...(p.scope.type === "session" && p.scope.id
              ? [eq(trades.sessionId, p.scope.id)]
              : []),
          ),
        )
        .orderBy(desc(trades.createdAt))
        .limit(500)
        .all();

      const scopedApprovals = drizzle
        .select()
        .from(tradeApprovals)
        .where(
          and(
            gte(tradeApprovals.requestedAt, windowStart),
            ...(p.scope.type === "session" && p.scope.id
              ? [eq(tradeApprovals.sessionId, p.scope.id)]
              : []),
          ),
        )
        .orderBy(desc(tradeApprovals.requestedAt))
        .limit(500)
        .all();

      const messageRows =
        p.includePrompts || p.includeToolPayloads
          ? drizzle
              .select()
              .from(agentMessages)
              .where(
                and(
                  gte(agentMessages.createdAt, windowStart),
                  ...(p.scope.type === "session" && p.scope.id
                    ? [eq(agentMessages.sessionId, p.scope.id)]
                    : []),
                ),
              )
              .orderBy(desc(agentMessages.createdAt))
              .limit(200)
              .all()
              .map((row) => ({
                id: row.id,
                agentRunId: row.agentRunId,
                sessionId: row.sessionId,
                tradeId: row.tradeId,
                cycleId: row.cycleId,
                role: row.role,
                providerKey: row.providerKey,
                modelId: row.modelId,
                parseFallback: row.parseFallback,
                createdAt: row.createdAt,
                ...(p.includePrompts
                  ? { messages: parseJsonForBundle(row.messagesJson) }
                  : {}),
                ...(p.includeToolPayloads
                  ? { toolCalls: parseJsonForBundle(row.toolCallsJson) }
                  : {}),
              }))
          : [];

      const settings = getOrCreateSettings(drizzle);
      let redactionCount = 0;

      function redactObj(obj: unknown): unknown {
        if (typeof obj === "string") {
          const redacted = redactText(obj);
          if (redacted !== obj) redactionCount++;
          return redacted;
        }
        if (typeof obj !== "object" || obj === null) return obj;
        if (Array.isArray(obj)) return obj.map(redactObj);
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
          if (
            /(api[-_]?key|secret|token|password|authorization|cookie|credential|private[-_]?key)/i.test(
              k,
            )
          ) {
            out[k] = "[REDACTED]";
            redactionCount++;
          } else {
            out[k] = redactObj(v);
          }
        }
        return out;
      }

      const databaseHealth = collectDatabaseHealth(services);
      const sessionScopedSections = [
        "events",
        "executionSteps",
        "decisionTraces",
        "agentRuns",
        "agentMessages",
        "externalCalls",
        "trades",
        "approvals",
      ];
      const globalSections = [
        "runtime",
        "databaseHealth",
        "schedules",
        "signalSourceRuntime",
        "signalSourcePolls",
        "settings",
      ];
      const fullySupportedScope =
        p.scope.type === "global" || p.scope.type === "session";
      const collectionWarnings = fullySupportedScope
        ? []
        : [
            `${p.scope.type} scope is not directly represented by every evidence table; applicable rows use the requested time window without additional scope filtering.`,
          ];

      const bundle = {
        schemaVersion: 2,
        outcome:
          databaseHealth.outcome === "degraded" || !fullySupportedScope
            ? "partial"
            : "ok",
        exportedAt: now.toISOString(),
        scope: p.scope,
        timeWindowMinutes: p.timeWindowMinutes,
        manifest: {
          redactionPolicyVersion: 2,
          scopeCoverage: {
            requested: p.scope,
            fullySupported: fullySupportedScope,
            sessionScopedSections:
              p.scope.type === "session" ? sessionScopedSections : [],
            globalSections,
          },
          optionalContentIncluded: {
            prompts: p.includePrompts,
            toolPayloads: p.includeToolPayloads,
          },
          rowLimits: { events: 1000, other: 500, agentMessages: 200 },
          warnings: collectionWarnings,
        },
        runtime: {
          bootId: getBootId(),
          pid: process.pid,
          uptimeSeconds: process.uptime(),
          memoryUsage: process.memoryUsage(),
          platform: process.platform,
          arch: process.arch,
          versions: process.versions,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          fingerprint: resolveRuntimeFingerprint(),
        },
        databaseHealth,
        events: redactObj(scopedEvents),
        agentRuns: redactObj(scopedRuns),
        agentMessages: redactObj(messageRows),
        externalCalls: redactObj(scopedCalls),
        executionSteps: redactObj(scopedSteps),
        decisionTraces: redactObj(scopedDecisions),
        trades: redactObj(scopedTrades),
        approvals: redactObj(scopedApprovals),
        schedules: redactObj(
          drizzle.select().from(scheduleRuntimeStates).limit(500).all(),
        ),
        signalSourceRuntime: redactObj(
          drizzle.select().from(signalSourceRuntimeStates).limit(500).all(),
        ),
        signalSourcePolls: redactObj(
          drizzle
            .select()
            .from(signalSourcePolls)
            .where(gte(signalSourcePolls.polledAt, windowStart))
            .orderBy(desc(signalSourcePolls.polledAt))
            .limit(500)
            .all(),
        ),
        settings: {
          defaultEventMinLevel: settings.defaultEventMinLevel,
          defaultTimeWindowMinutes: settings.defaultTimeWindowMinutes,
        },
      };

      const bundleDir = path.join(os.homedir(), ".exva", "debug-bundles");
      fs.mkdirSync(bundleDir, { recursive: true });
      const filename = `debug-${now.toISOString().replace(/[:.]/g, "-")}.json`;
      const bundlePath = path.join(bundleDir, filename);
      const bundleJson = JSON.stringify(bundle, null, 2);
      fs.writeFileSync(bundlePath, bundleJson, "utf8");

      const sizeBytes = Buffer.byteLength(bundleJson, "utf8");
      const warnings = [...collectionWarnings];
      if (sizeBytes > 25 * 1024 * 1024)
        warnings.push(
          "Bundle exceeds 25 MB. Consider narrowing scope or time window.",
        );

      return {
        path: bundlePath,
        sizeBytes,
        includedSections: [
          "runtime",
          "databaseHealth",
          "events",
          "executionSteps",
          "decisionTraces",
          "agentRuns",
          "agentMessages",
          "externalCalls",
          "trades",
          "approvals",
          "schedules",
          "signalSourceRuntime",
          "signalSourcePolls",
          "settings",
        ],
        redactionCount,
        warnings,
      };
    },
  );

  handle(
    ipcMain,
    channels.developer.openPath,
    ipcPayloadUnknownSchema,
    async (payload) => {
      const p = payload as { kind: string; path?: string };

      if (!ALLOWED_PATH_KINDS.has(p.kind))
        throw new Error("Path is not allowed.");
      if (!isAllowedPath(p.kind, p.path))
        throw new Error("Path is not allowed.");

      if (p.kind === "logsDirectory") {
        const logDir = resolveLogDir();
        if (!fs.existsSync(logDir))
          throw new Error("Log folder is not available yet.");
        await shell.openPath(logDir);
      } else if (p.kind === "debugBundle" && p.path) {
        shell.showItemInFolder(p.path);
      }

      return { opened: true as const };
    },
  );

  handle(
    ipcMain,
    channels.developer.listEventsV2,
    ipcPayloadUnknownSchema,
    async (payload) => {
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
      const windowStart =
        twMin > 0
          ? new Date(Date.now() - twMin * 60 * 1000).toISOString()
          : "1970-01-01T00:00:00.000Z";

      const LEVEL_ORDER: Record<string, number> = {
        DEBUG: 0,
        INFO: 1,
        WARN: 2,
        ERROR: 3,
      };
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
      const rows = drizzle
        .select()
        .from(events)
        .where(and(...conditions))
        .orderBy(desc(events.createdAt))
        .limit(clampedLimit + 1)
        .all();

      const queryMs = Date.now() - t0;
      const hasMore = rows.length > clampedLimit;
      const page = rows.slice(0, clampedLimit);
      const nextCursor = hasMore
        ? (page[page.length - 1]?.createdAt ?? null)
        : null;

      return { events: page, nextCursor, queryMs };
    },
  );
}

function redactText(value: string): string {
  return value
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [REDACTED]")
    .replace(
      /\b(sk-|ghp_|github_pat_|xox[a-z]-)[A-Za-z0-9_-]+/gi,
      "$1[REDACTED]",
    )
    .replace(
      /\b(api[-_]?key|secret|token|password|authorization)\s*[:=]\s*[^\s,;]+/gi,
      "$1=[REDACTED]",
    )
    .slice(0, 20_000);
}

function parseJsonForBundle(value: string | null): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return "[UNPARSEABLE]";
  }
}

function collectDatabaseHealth(services: AppServices): Record<string, unknown> {
  const dbPath = services.db.dbPath;
  const size = (file: string) =>
    fs.existsSync(file) ? fs.statSync(file).size : 0;
  try {
    const foreignKeyCheck = services.db.sqlite.pragma("foreign_key_check");
    return {
      pathHash: createHash("sha256").update(dbPath).digest("hex"),
      databaseBytes: size(dbPath),
      walBytes: size(`${dbPath}-wal`),
      shmBytes: size(`${dbPath}-shm`),
      sqliteVersion: services.db.sqlite
        .prepare("select sqlite_version() as version")
        .get(),
      journalMode: services.db.sqlite.pragma("journal_mode", { simple: true }),
      synchronous: services.db.sqlite.pragma("synchronous", { simple: true }),
      quickCheck: services.db.sqlite.pragma("quick_check(1)", { simple: true }),
      foreignKeyViolations: Array.isArray(foreignKeyCheck)
        ? foreignKeyCheck.slice(0, 100)
        : [],
    };
  } catch (error) {
    return {
      pathHash: createHash("sha256").update(dbPath).digest("hex"),
      outcome: "degraded",
      errorType: error instanceof Error ? error.name : typeof error,
    };
  }
}
