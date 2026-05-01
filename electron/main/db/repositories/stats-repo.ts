import type { DbClient } from "../client";
import type { CostBreakdown, DashboardStats, SessionStatus } from "@/lib/types";

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
    const tradeRows = sessionId
      ? ((this.client.sqlite
          .prepare("SELECT * FROM trades WHERE session_id = ? AND substr(created_at, 1, 10) = ?")
          .all(sessionId, today) as Array<{ status: string; final_pnl_usd: number | null; ai_cost_usd: number | null }>))
      : ((this.client.sqlite
          .prepare("SELECT * FROM trades WHERE substr(created_at, 1, 10) = ?")
          .all(today) as Array<{ status: string; final_pnl_usd: number | null; ai_cost_usd: number | null }>));
    const openTrades = sessionId
      ? ((this.client.sqlite
          .prepare("SELECT COUNT(*) AS count FROM trades WHERE session_id = ? AND status = 'open'")
          .get(sessionId) as { count: number }))
      : ((this.client.sqlite.prepare("SELECT COUNT(*) AS count FROM trades WHERE status = 'open'").get() as { count: number }));

    const closed = tradeRows.filter((row) => row.status === "closed");
    const dailyPnl = closed.reduce((sum, row) => sum + Number(row.final_pnl_usd ?? 0), 0);
    const wins = closed.filter((row) => Number(row.final_pnl_usd ?? 0) > 0).length;
    const spend = tradeRows.reduce((sum, row) => sum + Number(row.ai_cost_usd ?? 0), 0);

    return {
      session_status: status,
      daily_pnl_usd: dailyPnl,
      daily_pnl_pct: portfolioValue > 0 ? (dailyPnl / portfolioValue) * 100 : 0,
      total_trades_today: tradeRows.length,
      closed_trades_today: closed.length,
      win_rate_today: closed.length ? wins / closed.length : 0,
      open_trades: Number(openTrades.count ?? 0),
      daily_api_spend: spend,
      api_budget: apiBudget,
      portfolio_value: portfolioValue,
      unrealized_pnl: 0,
      session_uptime_min: uptimeMin,
    };
  }

  costBreakdown(): CostBreakdown {
    const byAgent = this.client.sqlite
      .prepare(
        `
        SELECT agent_type AS name,
          SUM(input_tokens + output_tokens) AS tokens,
          SUM(cost_usd) AS cost
        FROM agent_runs
        GROUP BY agent_type
        ORDER BY cost DESC
        `,
      )
      .all() as CostBreakdown["by_agent"];

    const byTrade = this.client.sqlite
      .prepare(
        `
        SELECT trades.instrument_symbol AS instrumentSymbol, SUM(agent_runs.cost_usd) AS cost
        FROM agent_runs
        JOIN trades ON trades.id = agent_runs.trade_id
        GROUP BY trades.id
        ORDER BY cost DESC
        LIMIT 20
        `,
      )
      .all() as CostBreakdown["by_trade"];

    const dailyHistory = this.client.sqlite
      .prepare(
        `
        SELECT substr(created_at, 1, 10) AS date, SUM(cost_usd) AS cost
        FROM agent_runs
        GROUP BY substr(created_at, 1, 10)
        ORDER BY date DESC
        LIMIT 7
        `,
      )
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
