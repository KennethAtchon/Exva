import { z } from "zod";
import type { BacktestRun } from "@electron/shared/domain";
import { templateCreateInputSchema } from "@electron/shared/validation/schemas";
import { defineCapability } from "./capability";
import { CONFIRM_CLASS, emptyInputSchema } from "./capabilities-shared";
import { resolveSession } from "./resolve-session";
import { safeJsonParse } from "../infra/safe-json-parse";

const timeframeSchema = z.enum(["5m", "15m", "30m", "1h", "4h", "1d", "1w"]);

function compactBacktestRun(r: BacktestRun) {
  const fold = safeJsonParse<{ strategyId?: string }>(
    r.foldConfigJson,
    undefined,
    "capabilities-labs.foldConfig",
  );
  const strategyId = fold?.strategyId ?? null;
  return {
    id: r.id,
    experienceId: r.experienceId,
    strategyId,
    verdict: r.verdict,
    windowStart: r.windowStart,
    windowEnd: r.windowEnd,
    createdAt: r.createdAt,
  };
}

export const listTemplates = defineCapability<Record<string, never>>({
  key: "list_templates",
  label: "List session templates",
  kind: "read",
  description: "List session templates available in the current environment.",
  inputSchema: emptyInputSchema,
  describe: () => "List session templates.",
  execute: (_input, services) => ({
    templates: services.sessionTemplates.list({}).map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
    })),
  }),
});

export const useTemplate = defineCapability<{ id: string }>({
  key: "use_template",
  label: "Use session template",
  kind: "mutating",
  confirmClass: CONFIRM_CLASS.templateWrite,
  description: "Apply a session template (creates a new session from it).",
  inputSchema: z.object({ id: z.string().min(1) }),
  describe: (input) => `Use template ${input.id}.`,
  affectedEntity: (input) => `template:${input.id}`,
  execute: (input, services) => services.sessionTemplates.apply(input.id),
});

export const createTemplate = defineCapability<
  z.infer<typeof templateCreateInputSchema>
>({
  key: "create_template",
  label: "Create session template",
  kind: "mutating",
  confirmClass: CONFIRM_CLASS.templateWrite,
  description: "Create a session template from a payload or source session.",
  inputSchema: templateCreateInputSchema as unknown as z.ZodType<
    z.infer<typeof templateCreateInputSchema>
  >,
  describe: (input) => `Create template "${input.name}".`,
  execute: (input, services) => services.sessionTemplates.create(input),
});

export const deleteTemplate = defineCapability<{ id: string }>({
  key: "delete_template",
  label: "Delete session template",
  kind: "mutating",
  confirmClass: CONFIRM_CLASS.templateWrite,
  description: "Delete a session template by id.",
  inputSchema: z.object({ id: z.string().min(1) }),
  describe: (input) => `Delete template ${input.id}.`,
  affectedEntity: (input) => `template:${input.id}`,
  execute: (input, services) => {
    services.sessionTemplates.delete(input.id);
    return { deleted: true, id: input.id };
  },
});

export const listBacktests = defineCapability<{
  experienceId?: string;
  limit?: number;
}>({
  key: "list_backtests",
  label: "List backtests",
  kind: "read",
  description: "List recent backtest lab runs.",
  inputSchema: z.object({
    experienceId: z.string().optional(),
    limit: z.number().int().positive().max(100).optional(),
  }),
  describe: () => "List recent backtest runs.",
  execute: (input, services) => {
    const runs = services.backtestLab.listRuns(
      input.experienceId,
      input.limit ?? 30,
    );
    return {
      count: runs.length,
      runs: runs.map((r) => compactBacktestRun(r)),
    };
  },
});

export const getBacktest = defineCapability<{ id: string }>({
  key: "get_backtest",
  label: "Get backtest",
  kind: "read",
  description: "Get one backtest run by id.",
  inputSchema: z.object({ id: z.string().min(1) }),
  describe: (input) => `Read backtest ${input.id}.`,
  execute: (input, services) => {
    const run = services.backtestLab.getRun(input.id);
    if (!run) return { run: null };
    return { run: compactBacktestRun(run) };
  },
});

export const runBacktest = defineCapability<{
  experienceId: string;
  strategyId: string;
  symbols: string[];
  timeframe: z.infer<typeof timeframeSchema>;
  windowStart: string;
  windowEnd: string;
  folds?: number;
  strategyParams?: Record<string, unknown>;
}>({
  key: "run_backtest",
  label: "Run backtest",
  kind: "mutating",
  confirmClass: CONFIRM_CLASS.backtest,
  description:
    "Run a backtest lab job (compute-heavy; may take a while). Confirm before running.",
  inputSchema: z.object({
    experienceId: z.string().min(1),
    strategyId: z.string().min(1),
    symbols: z.array(z.string().min(1)).min(1),
    timeframe: timeframeSchema,
    windowStart: z.string().min(1),
    windowEnd: z.string().min(1),
    folds: z.number().int().positive().optional(),
    strategyParams: z.record(z.unknown()).optional(),
  }),
  describe: (input) =>
    `Run backtest ${input.strategyId} on ${input.symbols.join(",")} ${input.windowStart}→${input.windowEnd} (compute cost).`,
  execute: async (input, services) => {
    const { run, result } = await services.backtestLab.run({
      experienceId: input.experienceId,
      strategyId: input.strategyId,
      symbols: input.symbols,
      timeframe: input.timeframe,
      windowStart: input.windowStart,
      windowEnd: input.windowEnd,
      folds: input.folds ?? 1,
      strategyParams: input.strategyParams,
    });
    return {
      id: run.id,
      verdict: run.verdict,
      tradeCount: result.tradeCount,
      expectancyBps: result.expectancyBps,
    };
  },
});

export const listPeriodAutopsies = defineCapability<{
  scope: "global" | "session";
  session?: string;
  limit?: number;
}>({
  key: "list_period_autopsies",
  label: "List period autopsies",
  kind: "read",
  description: "List prior period autopsy runs for global or session scope.",
  inputSchema: z.object({
    scope: z.enum(["global", "session"]),
    session: z.string().optional(),
    limit: z.number().int().positive().max(50).optional(),
  }),
  describe: (input) => `List ${input.scope} period autopsies.`,
  execute: (input, services) => {
    const sessionId =
      input.scope === "session" && input.session
        ? resolveSession(services, input.session).id
        : undefined;
    const { items, total } = services.periodAutopsy.listByScope({
      scope: input.scope,
      sessionId,
      limit: input.limit ?? 20,
    });
    return {
      total,
      autopsies: items.map((r) => ({
        id: r.id,
        scope: r.scope,
        sessionId: r.sessionId,
        windowStart: r.windowStart,
        windowEnd: r.windowEnd,
        tradeCount: r.tradeCount,
        qualityGrade: r.qualityGrade,
        createdAt: r.createdAt,
      })),
    };
  },
});

export const getPeriodAutopsy = defineCapability<{ periodAutopsyId: string }>({
  key: "get_period_autopsy",
  label: "Get period autopsy",
  kind: "read",
  description: "Get one period autopsy record by id (compact summary).",
  inputSchema: z.object({ periodAutopsyId: z.string().min(1) }),
  describe: (input) => `Read period autopsy ${input.periodAutopsyId}.`,
  execute: (input, services) => {
    const record = services.periodAutopsy.getById(input.periodAutopsyId);
    return {
      id: record.id,
      scope: record.scope,
      sessionId: record.sessionId,
      windowStart: record.windowStart,
      windowEnd: record.windowEnd,
      tradeCount: record.tradeCount,
      qualityGrade: record.qualityGrade,
      totalCostUsd: record.totalCostUsd,
      createdAt: record.createdAt,
    };
  },
});

export const listAutopsyLessons = defineCapability<{
  scope: "global" | "session";
  session?: string;
}>({
  key: "list_autopsy_lessons",
  label: "List autopsy lessons",
  kind: "read",
  description: "List period-autopsy lessons for a scope.",
  inputSchema: z.object({
    scope: z.enum(["global", "session"]),
    session: z.string().optional(),
  }),
  describe: (input) => `List ${input.scope} autopsy lessons.`,
  execute: (input, services) => {
    const sessionId =
      input.scope === "session" && input.session
        ? resolveSession(services, input.session).id
        : undefined;
    const lessons = services.periodAutopsy.listLessons({
      scope: input.scope,
      sessionId,
    });
    return {
      count: lessons.length,
      lessons: lessons.map((l) => ({
        id: l.id,
        status: l.status,
        severity: l.severity,
        category: l.category,
        lesson: l.lesson.slice(0, 200),
      })),
    };
  },
});

export const promoteLesson = defineCapability<{
  lessonId: string;
  targetScope: "global" | "session";
  targetSession?: string;
}>({
  key: "promote_lesson",
  label: "Promote autopsy lesson",
  kind: "mutating",
  confirmClass: CONFIRM_CLASS.autopsy,
  description: "Promote a period-autopsy lesson to another scope.",
  inputSchema: z.object({
    lessonId: z.string().min(1),
    targetScope: z.enum(["global", "session"]),
    targetSession: z.string().optional(),
  }),
  describe: (input) =>
    `Promote lesson ${input.lessonId} to ${input.targetScope}.`,
  affectedEntity: (input) => `lesson:${input.lessonId}`,
  execute: (input, services) => {
    const targetSessionId =
      input.targetScope === "session" && input.targetSession
        ? resolveSession(services, input.targetSession).id
        : undefined;
    return services.periodAutopsy.promoteLesson({
      lessonId: input.lessonId,
      targetScope: input.targetScope,
      targetSessionId,
    });
  },
});

export const getDataCoverage = defineCapability<Record<string, never>>({
  key: "get_data_coverage",
  label: "Get data coverage",
  kind: "read",
  description: "Read Data Doctor coverage matrix (compact).",
  inputSchema: emptyInputSchema,
  describe: () => "Read market data coverage matrix.",
  execute: (_input, services) => {
    const cells = services.dataDoctor.coverageMatrix();
    return {
      cellCount: cells.length,
      staleOrDead: cells.filter((c) => c.freshness !== "fresh").length,
      gapCount: cells.reduce((n, c) => n + c.gapCount, 0),
      cells: cells.slice(0, 40).map((c) => ({
        symbol: c.symbol,
        timeframe: c.timeframe,
        freshness: c.freshness,
        gapCount: c.gapCount,
      })),
    };
  },
});

export const getProviderHealth = defineCapability<Record<string, never>>({
  key: "get_provider_health",
  label: "Get provider health",
  kind: "read",
  description: "Read Data Doctor market-data provider health.",
  inputSchema: emptyInputSchema,
  describe: () => "Read market-data provider health.",
  execute: (_input, services) => ({
    providers: services.dataDoctor.providerHealth(),
  }),
});

export const runBackfill = defineCapability<{
  symbol: string;
  timeframe: z.infer<typeof timeframeSchema>;
  instrumentClass?: string;
  barCount?: number;
}>({
  key: "run_backfill",
  label: "Run data backfill",
  kind: "mutating",
  confirmClass: CONFIRM_CLASS.dataDoctor,
  description: "Backfill market-data bars for a symbol/timeframe (API cost).",
  inputSchema: z.object({
    symbol: z.string().min(1),
    timeframe: timeframeSchema,
    instrumentClass: z.string().optional(),
    barCount: z.number().int().positive().optional(),
  }),
  describe: (input) =>
    `Backfill ${input.symbol} ${input.timeframe} (data API cost).`,
  affectedEntity: (input) => `symbol:${input.symbol}`,
  execute: (input, services) => services.dataDoctor.backfill(input),
});
