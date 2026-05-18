import type { DbClient } from "../../client";
import type { CostBreakdown, DashboardStats, SessionStatus } from "@/lib/types";
import { and, desc, eq, sql } from "drizzle-orm";
import { agentRuns, trades } from "../../schema";

export class StatsRepo {
  constructor(private readonly client: DbClient) {}

  dashboardStats(
    sessionId: string | null,
    status: SessionStatus,
    portfolioValue: number,
    uptimeMin: number,
    apiBudget: number,
  ): DashboardStats {
    const today = new Date().toISOString().slice(0, 10);
    const todayCondition = sql`substr(${trades.createdAt}, 1, 10) = ${today}`;
    const runTodayCondition = sql`substr(${agentRuns.createdAt}, 1, 10) = ${today}`;
    const tradeRows = this.client.db
      .select({
        status: trades.status,
        final_pnl_usd: trades.finalPnlUsd,
      })
      .from(trades)
      .where(sessionId ? and(eq(trades.sessionId, sessionId), todayCondition) : todayCondition)
      .all();
    const spendRow = this.client.db
      .select({ spend: sql<number>`sum(${agentRuns.costUsd})` })
      .from(agentRuns)
      .where(sessionId ? and(eq(agentRuns.sessionId, sessionId), runTodayCondition) : runTodayCondition)
      .get();
    const openTrades = this.client.db
      .select({ count: sql<number>`count(*)` })
      .from(trades)
      .where(sessionId ? and(eq(trades.sessionId, sessionId), eq(trades.status, "open")) : eq(trades.status, "open"))
      .get();

    const closed = tradeRows.filter((row) => row.status === "closed");
    const dailyPnl = closed.reduce((sum, row) => sum + Number(row.final_pnl_usd ?? 0), 0);
    const wins = closed.filter((row) => Number(row.final_pnl_usd ?? 0) > 0).length;
    const spend = Number(spendRow?.spend ?? 0);

    return {
      session_status: status,
      daily_pnl_usd: dailyPnl,
      daily_pnl_pct: portfolioValue > 0 ? (dailyPnl / portfolioValue) * 100 : 0,
      total_trades_today: tradeRows.length,
      closed_trades_today: closed.length,
      win_rate_today: closed.length ? wins / closed.length : 0,
      open_trades: Number(openTrades?.count ?? 0),
      daily_api_spend: spend,
      api_budget: apiBudget,
      portfolio_value: portfolioValue,
      portfolio_value_source: "broker",
      portfolio_broker_count: 0,
      unrealized_pnl: 0,
      session_uptime_min: uptimeMin,
    };
  }

  costBreakdown(input?: { sessionId?: string | null; dateRange?: "today" | "all" }): CostBreakdown {
    const sessionId = input?.sessionId ?? null;
    const dateRange = input?.dateRange ?? "today";
    const today = new Date().toISOString().slice(0, 10);
    const sevenDayStart = new Date();
    sevenDayStart.setUTCDate(sevenDayStart.getUTCDate() - 6);
    const historyStart = sevenDayStart.toISOString().slice(0, 10);

    const scopedRunCondition =
      sessionId && dateRange === "today"
        ? and(eq(agentRuns.sessionId, sessionId), sql`substr(${agentRuns.createdAt}, 1, 10) = ${today}`)
        : sessionId
          ? eq(agentRuns.sessionId, sessionId)
          : dateRange === "today"
            ? sql`substr(${agentRuns.createdAt}, 1, 10) = ${today}`
            : undefined;
    const historyCondition = sessionId
      ? and(eq(agentRuns.sessionId, sessionId), sql`substr(${agentRuns.createdAt}, 1, 10) >= ${historyStart}`)
      : sql`substr(${agentRuns.createdAt}, 1, 10) >= ${historyStart}`;

    const byAgentQuery = this.client.db
      .select({
        name: agentRuns.agentType,
        tokens: sql<number>`sum(${agentRuns.inputTokens} + ${agentRuns.outputTokens})`,
        cost: sql<number>`sum(${agentRuns.costUsd})`,
      })
      .from(agentRuns);
    const byAgent = (scopedRunCondition ? byAgentQuery.where(scopedRunCondition) : byAgentQuery)
      .groupBy(agentRuns.agentType)
      .orderBy(desc(sql`sum(${agentRuns.costUsd})`))
      .all() as CostBreakdown["by_agent"];

    const byTradeQuery = this.client.db
      .select({
        instrumentSymbol: trades.instrumentSymbol,
        cost: sql<number>`sum(${agentRuns.costUsd})`,
      })
      .from(agentRuns)
      .innerJoin(trades, eq(trades.id, agentRuns.tradeId));
    const byTrade = (scopedRunCondition ? byTradeQuery.where(scopedRunCondition) : byTradeQuery)
      .groupBy(trades.id)
      .orderBy(desc(sql`sum(${agentRuns.costUsd})`))
      .limit(20)
      .all() as CostBreakdown["by_trade"];

    const dailyHistory = this.client.db
      .select({
        date: sql<string>`substr(${agentRuns.createdAt}, 1, 10)`,
        cost: sql<number>`sum(${agentRuns.costUsd})`,
      })
      .from(agentRuns)
      .where(historyCondition)
      .groupBy(sql`substr(${agentRuns.createdAt}, 1, 10)`)
      .orderBy(desc(sql`substr(${agentRuns.createdAt}, 1, 10)`))
      .limit(7)
      .all() as CostBreakdown["daily_history"];

    return {
      total: byAgent.reduce((sum, row) => sum + Number(row.cost ?? 0), 0),
      by_agent: byAgent,
      by_trade: byTrade,
      cache_savings_usd: 0,
      daily_history: dailyHistory.reverse(),
    };
  }
}
