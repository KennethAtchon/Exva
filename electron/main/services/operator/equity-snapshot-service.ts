import type {
  EquitySnapshotsRepo,
  EquitySnapshotRow,
} from "../../db/repositories/system/equity-snapshots-repo";
import type { BrokerAccountsRepo } from "../../db/repositories/brokers/broker-accounts-repo";
import type { PaperBalancesRepo } from "../../db/repositories/brokers/paper-balances-repo";
import type { TradesRepo } from "../../db/repositories/trades/trades-repo";
import type { SessionRepo } from "../../db/repositories/sessions/session-repo";
import type { ApiCallLogRepo } from "../../db/repositories/system/api-call-log-repo";
import type { AgentRunsRepo } from "../../db/repositories/agents/agent-runs-repo";
import type { EventBus } from "../infra/event-bus";

export type EquityRange = "1W" | "1M" | "3M" | "all";

/**
 * Hourly + on-trade-close equity snapshots (finish-line 08 T5).
 * Open positions valued at last-known marks; staleness is surfaced.
 */
export class EquitySnapshotService {
  private lastSnapAt = 0;

  constructor(
    private readonly deps: {
      snapshots: EquitySnapshotsRepo;
      brokerAccounts: BrokerAccountsRepo;
      paperBalances: PaperBalancesRepo;
      trades: TradesRepo;
      sessions: SessionRepo;
      apiCallLog: ApiCallLogRepo;
      agentRuns: AgentRunsRepo;
      eventBus: EventBus;
    },
  ) {}

  takeSnapshot(now = new Date()): EquitySnapshotRow {
    const accounts = this.deps.brokerAccounts.list();
    const perAccount: Record<string, number> = {};
    let total = 0;
    let marksStale = false;

    for (const acct of accounts) {
      let bal = acct.balanceCacheUsd ?? 0;
      if (acct.mode === "paper") {
        const paper = this.deps.paperBalances.find(acct.id);
        if (paper) bal = paper.balance;
      }
      if (
        acct.balanceCachedAt &&
        Date.now() - Date.parse(acct.balanceCachedAt) > 6 * 60 * 60 * 1000
      ) {
        marksStale = true;
      }
      perAccount[acct.id] = bal;
      total += bal;
    }

    const open = this.deps.trades.listOpenAndPending();
    const perExperience: Record<string, number> = {};
    for (const trade of open) {
      const mark = trade.unrealized_pnl ?? 0;
      if (trade.current_price == null) marksStale = true;
      total += mark;
      const session = trade.sessionId
        ? this.deps.sessions.findById(trade.sessionId)
        : null;
      const expId = session?.experienceId ?? trade.sessionId ?? "unassigned";
      perExperience[expId] = (perExperience[expId] ?? 0) + mark;
    }

    // Attribute closed-trade realized P&L to experiences (lifetime contribution).
    const closedWindowStart = new Date(
      now.getTime() - 365 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const closed = this.deps.trades.listClosedInWindow({
      windowStart: closedWindowStart,
      windowEnd: now.toISOString(),
    });
    for (const trade of closed) {
      const session = trade.sessionId
        ? this.deps.sessions.findById(trade.sessionId)
        : null;
      const expId = session?.experienceId ?? trade.sessionId ?? "unassigned";
      perExperience[expId] =
        (perExperience[expId] ?? 0) + (trade.final_pnl_usd ?? 0);
    }

    // Closed realized P&L already reflected in balances for live; for paper,
    // fold closed session P&L into experience attribution.
    const today = now.toISOString().slice(0, 10);
    let aiSpendUsd = 0;
    for (const s of this.deps.sessions.list({ includeArchived: false })) {
      aiSpendUsd += this.deps.apiCallLog.dailyDataSpendUsd(s.id, today);
      aiSpendUsd += this.deps.agentRuns.dailyAiSpendUsd(s.id, today);
      if (s.experienceId) {
        perExperience[s.experienceId] = perExperience[s.experienceId] ?? 0;
      }
    }

    // Sanity: contributions should not invent portfolio equity — they are an
    // attribution map (open marks + realized), not a second cash ledger.
    const contributionSum = Object.values(perExperience).reduce(
      (a, b) => a + b,
      0,
    );
    if (
      Number.isFinite(contributionSum) &&
      Math.abs(contributionSum) > Math.abs(total) + 1e-6
    ) {
      // Attribution can exceed total when cash is below assigned experience
      // P&L (common on paper); surface via stale so UI can warn.
      marksStale = true;
    }

    const row = this.deps.snapshots.insert({
      id: crypto.randomUUID(),
      ts: now.toISOString(),
      total,
      perAccount,
      perExperience,
      aiSpendUsd,
      marksStale,
    });
    this.lastSnapAt = now.getTime();
    this.deps.eventBus.emit("equity_snapshot", {
      ts: row.ts,
      total: row.total,
      marksStale: row.marksStale,
    });
    return row;
  }

  /** Call from supervisor tick / trade_closed — at most hourly unless force. */
  maybeSnapshot(force = false, now = new Date()): EquitySnapshotRow | null {
    if (!force && now.getTime() - this.lastSnapAt < 55 * 60 * 1000) {
      return null;
    }
    return this.takeSnapshot(now);
  }

  curve(range: EquityRange = "1M"): {
    points: EquitySnapshotRow[];
    dayPnl: number | null;
    weekPnl: number | null;
    latest: EquitySnapshotRow | null;
  } {
    const now = Date.now();
    const fromTs =
      range === "all"
        ? undefined
        : new Date(
            now -
              (range === "1W" ? 7 : range === "1M" ? 30 : 90) *
                24 *
                60 *
                60 *
                1000,
          ).toISOString();
    const points = this.deps.snapshots.listRange({ fromTs });
    const latest = this.deps.snapshots.latest();
    const dayAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();
    const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
    const dayRef = points.find((p) => p.ts >= dayAgo) ?? points[0];
    const weekRef = points.find((p) => p.ts >= weekAgo) ?? points[0];
    return {
      points,
      dayPnl: latest && dayRef ? latest.total - dayRef.total : null,
      weekPnl: latest && weekRef ? latest.total - weekRef.total : null,
      latest,
    };
  }

  attribution(range: EquityRange = "1M"): {
    series: Array<{
      ts: string;
      total: number;
      aiSpendUsd: number;
      perExperience: Record<string, number>;
      netOfAi: number;
    }>;
  } {
    const { points } = this.curve(range);
    return {
      series: points.map((p) => ({
        ts: p.ts,
        total: p.total,
        aiSpendUsd: p.aiSpendUsd,
        perExperience: p.perExperience,
        netOfAi: p.total - p.aiSpendUsd,
      })),
    };
  }
}
