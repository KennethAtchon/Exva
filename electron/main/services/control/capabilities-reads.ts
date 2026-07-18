import { z } from "zod";
import { listExperiences } from "../../experiences";
import { sessionMatchesEnvironment } from "@electron/shared/domain/environment-mode";
import { resolveExecutionModeFilter } from "../session/environment-scope";
import { defineCapability } from "./capability";
import type { AppServices } from "../app-services";
import { emptyInputSchema } from "./capabilities-shared";
import { resolveSession } from "./resolve-session";

function sessionsInWorkspaceEnvironment(services: AppServices) {
  const prefs = services.repos.workspacePreferences.get();
  const executionMode = resolveExecutionModeFilter(prefs, {});
  return services.repos.session.list({
    includeArchived: false,
    executionMode,
  });
}

export const getDashboardStats = defineCapability<{ session?: string }>({
  key: "get_dashboard_stats",
  label: "Get dashboard stats",
  kind: "read",
  description:
    "Workspace (or session) dashboard stats: portfolio value, open trades, PnL, API spend vs budget, uptime.",
  inputSchema: z.object({ session: z.string().optional() }),
  describe: (input) =>
    input.session
      ? `Read dashboard stats for session "${input.session}".`
      : "Read workspace dashboard stats.",
  execute: async (input, services) => {
    const session = input.session
      ? resolveSession(services, input.session)
      : null;
    const prefs = services.repos.workspacePreferences.get();
    const focused = services.repos.session.getFocused();
    const focusedInEnv =
      !session &&
      focused &&
      sessionMatchesEnvironment(
        focused.executionMode,
        prefs.globalEnvironmentMode,
      )
        ? focused
        : null;
    const sessionId = session?.id ?? focusedInEnv?.id ?? null;
    const envSessions = sessionsInWorkspaceEnvironment(services);
    const apiBudget = sessionId
      ? services.strategyContext.get(sessionId).riskConfig.maxAiSpendUsd
      : envSessions.reduce(
          (sum, s) =>
            sum + services.strategyContext.get(s.id).riskConfig.maxAiSpendUsd,
          0,
        );
    const uptimeMin = sessionId
      ? services.session.uptimeMin(sessionId)
      : envSessions
          .filter((s) => ["active", "paused"].includes(s.status))
          .reduce((sum, s) => sum + services.session.uptimeMin(s.id), 0);
    const sessionStatus =
      (session ?? focusedInEnv)?.status ?? ("idle" as const);
    const portfolio = await services.session.getPortfolioValue(
      sessionId ?? undefined,
    );
    const stats = services.repos.stats.dashboardStats(
      sessionId,
      sessionStatus,
      portfolio.value,
      uptimeMin,
      apiBudget,
      sessionId ? undefined : envSessions.map((s) => s.id),
    );
    return {
      sessionId,
      portfolioValue: portfolio.value,
      portfolioSource: portfolio.source,
      openTrades: stats.open_trades,
      dailyPnlUsd: stats.daily_pnl_usd,
      totalTradesToday: stats.total_trades_today,
      apiSpendUsd: stats.daily_api_spend,
      apiBudgetUsd: apiBudget,
      uptimeMin,
      sessionStatus,
    };
  },
});

export const getCostBreakdown = defineCapability<{
  dateRange?: "today" | "all";
  session?: string;
}>({
  key: "get_cost_breakdown",
  label: "Get cost breakdown",
  kind: "read",
  description:
    "AI/data API cost breakdown for today or all time, optionally scoped to a session.",
  inputSchema: z.object({
    dateRange: z.enum(["today", "all"]).optional(),
    session: z.string().optional(),
  }),
  describe: (input) =>
    `Read ${input.dateRange ?? "today"} cost breakdown${input.session ? ` for "${input.session}"` : ""}.`,
  execute: (input, services) => {
    const session = input.session
      ? resolveSession(services, input.session)
      : null;
    const envSessions = sessionsInWorkspaceEnvironment(services);
    return services.repos.stats.costBreakdown({
      sessionId: session?.id ?? null,
      sessionIds: session ? undefined : envSessions.map((s) => s.id),
      dateRange: input.dateRange ?? "today",
    });
  },
});

export const getTradeDetail = defineCapability<{ tradeId: string }>({
  key: "get_trade_detail",
  label: "Get trade detail",
  kind: "read",
  description:
    "Get one trade with agent runs, messages, and gate steps (compact).",
  inputSchema: z.object({ tradeId: z.string().min(1) }),
  describe: (input) => `Read detail for trade ${input.tradeId}.`,
  execute: (input, services) => {
    const trade = services.repos.trades.require(input.tradeId);
    const messages = services.repos.agentMessages.listByTrade(input.tradeId);
    const cycleId = messages.find((m) => m.cycle_id)?.cycle_id;
    const gateSteps =
      trade.sessionId && cycleId
        ? services.repos.sessionExecutionSteps
            .getLatestByCycle(trade.sessionId, cycleId)
            .map((step) => ({
              stage: step.stage,
              status: step.status,
              lastErrorCode: step.lastErrorCode,
            }))
        : [];
    const runs = services.repos.agentRuns.listByTrade(input.tradeId);
    return {
      id: trade.id,
      symbol: trade.instrumentSymbol,
      side: trade.side,
      status: trade.status,
      notionalUsd: trade.position_size_usd,
      entryPrice: trade.entry_price,
      realizedPnlUsd: trade.final_pnl_usd,
      unrealizedPnlUsd: trade.unrealized_pnl,
      brokerAccountId: trade.brokerAccountId ?? null,
      sessionId: trade.sessionId ?? null,
      runCount: runs.length,
      messageCount: messages.length,
      gateSteps,
    };
  },
});

export const getEquityCurve = defineCapability<{
  range?: "1W" | "1M" | "3M" | "all";
}>({
  key: "get_equity_curve",
  label: "Get equity curve",
  kind: "read",
  description: "Portfolio equity curve points with day/week PnL deltas.",
  inputSchema: z.object({
    range: z.enum(["1W", "1M", "3M", "all"]).optional(),
  }),
  describe: (input) => `Read equity curve (${input.range ?? "1M"}).`,
  execute: (input, services) => {
    const curve = services.equitySnapshots.curve(input.range ?? "1M");
    const points = curve.points.slice(-60).map((p) => ({
      ts: p.ts,
      total: p.total,
      aiSpendUsd: p.aiSpendUsd,
    }));
    return {
      dayPnl: curve.dayPnl,
      weekPnl: curve.weekPnl,
      latestTotal: curve.latest?.total ?? null,
      pointCount: curve.points.length,
      points,
    };
  },
});

export const getLatestBriefing = defineCapability<Record<string, never>>({
  key: "get_latest_briefing",
  label: "Get latest briefing",
  kind: "read",
  description: "Read the most recent morning briefing, if any.",
  inputSchema: emptyInputSchema,
  describe: () => "Read the latest morning briefing.",
  execute: (_input, services) => {
    const briefing = services.morningBriefing.latest();
    if (!briefing) return { briefing: null };
    return {
      briefing: {
        date: briefing.date,
        narrative: briefing.narrative,
        yesterdayPnlUsd: briefing.doc.yesterdayPnlUsd,
        aiSpendUsd: briefing.doc.aiSpendUsd,
        openPositions: briefing.doc.openPositions,
        dataCoverageStatus: briefing.doc.dataCoverageStatus,
        createdAt: briefing.createdAt,
      },
    };
  },
});

export const listEvents = defineCapability<{
  session?: string;
  minLevel?: "DEBUG" | "INFO" | "WARN" | "ERROR";
  search?: string;
  limit?: number;
}>({
  key: "list_events",
  label: "List events",
  kind: "read",
  description:
    "List recent system/session events (capped). Optional session, min level, search.",
  inputSchema: z.object({
    session: z.string().optional(),
    minLevel: z.enum(["DEBUG", "INFO", "WARN", "ERROR"]).optional(),
    search: z.string().optional(),
    limit: z.number().int().positive().max(100).optional(),
  }),
  describe: (input) =>
    `List events${input.session ? ` for "${input.session}"` : ""} (limit ${input.limit ?? 40}).`,
  execute: (input, services) => {
    const sessionId = input.session
      ? resolveSession(services, input.session).id
      : undefined;
    const limit = input.limit ?? 40;
    const rows = services.repos.events
      .query({
        sessionId,
        minLevel: input.minLevel,
        search: input.search,
        limit,
      })
      .slice(0, limit);
    return {
      count: rows.length,
      events: rows.map((e) => ({
        id: e.id,
        level: e.level,
        agentType: e.agent_type,
        message: e.message,
        sessionId: e.session_id,
        createdAt: e.created_at,
      })),
    };
  },
});

export const listExperiencesCap = defineCapability<Record<string, never>>({
  key: "list_experiences",
  label: "List experiences",
  kind: "read",
  description: "List registered trading experiences (id + display name).",
  inputSchema: emptyInputSchema,
  describe: () => "List registered experiences.",
  execute: () => ({
    experiences: listExperiences().map((e) => ({
      id: e.id,
      displayName: e.displayName,
    })),
  }),
});

export const listExperienceScorecards = defineCapability<{
  experienceId?: string;
}>({
  key: "list_experience_scorecards",
  label: "List experience scorecards",
  kind: "read",
  description:
    "Generate compact experience scorecards (win rate, expectancy, promotion tier). Optional experienceId filter.",
  inputSchema: z.object({ experienceId: z.string().optional() }),
  describe: (input) =>
    input.experienceId
      ? `Read scorecard for experience ${input.experienceId}.`
      : "Read all experience scorecards.",
  execute: (input, services) => {
    const cards = input.experienceId
      ? [services.experienceScorecard.generateForExperience(input.experienceId)]
      : services.experienceScorecard.generateAll();
    return {
      scorecards: cards.map((c) => ({
        experienceId: c.experienceId,
        displayName: c.displayName,
        tradeCount: c.tradeCount,
        winRate: c.winRate,
        expectancy: c.expectancy,
        netPnlUsd: c.netPnlUsd,
        netPnlAfterCostsUsd: c.netPnlAfterCostsUsd,
        promotionTier: c.promotionTier,
        meetsPromotion: c.meetsPromotion,
      })),
    };
  },
});
