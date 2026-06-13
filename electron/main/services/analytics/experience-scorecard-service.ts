import type { Trade } from "@/lib/types";
import type { BrokerAccountsRepo } from "../../db/repositories/brokers/broker-accounts-repo";
import type { SessionBrokerAssignmentsRepo } from "../../db/repositories/sessions/session-broker-assignments-repo";
import type { SessionRepo } from "../../db/repositories/sessions/session-repo";
import type { TradesRepo } from "../../db/repositories/trades/trades-repo";
import type { ApiCallLogRepo } from "../../db/repositories/system/api-call-log-repo";
import { listExperiences } from "../../experiences/index";
import {
  meetsPromotionCriteria,
  type TradeScorecard,
} from "./paper-scorecard-service";
import type { PromotionTier } from "@electron/shared/domain/promotion-ladder";
import { resolveSessionPromotionTier } from "@electron/shared/domain/promotion-ladder";

export interface ExperienceScorecard {
  experienceId: string;
  displayName: string;
  sessionCount: number;
  tradeCount: number;
  winCount: number;
  lossCount: number;
  winRate: number;
  expectancy: number;
  maxDrawdownPct: number;
  netPnlUsd: number;
  netPnlAfterCostsUsd: number;
  totalAiSpendUsd: number;
  totalDataSpendUsd: number;
  costPerTradeUsd: number;
  avgHoldHours: number;
  promotionTier: PromotionTier;
  meetsPromotion: boolean;
  failedPromotionCriteria: string[];
  generatedAt: string;
}

interface ExperienceScorecardServiceDeps {
  trades: TradesRepo;
  brokerAccounts: BrokerAccountsRepo;
  brokerAssignments: SessionBrokerAssignmentsRepo;
  session: SessionRepo;
  apiCallLog: ApiCallLogRepo;
}

export class ExperienceScorecardService {
  constructor(private readonly deps: ExperienceScorecardServiceDeps) {}

  generateAll(): ExperienceScorecard[] {
    return listExperiences().map((exp) => this.generateForExperience(exp.id));
  }

  generateForExperience(experienceId: string): ExperienceScorecard {
    const experience = listExperiences().find((e) => e.id === experienceId);
    const displayName = experience?.displayName ?? experienceId;
    const sessions = this.deps.session
      .list()
      .filter((s) => s.experienceId === experienceId);

    const closedTrades = sessions.flatMap((session) =>
      this.deps.trades
        .listClosed(session.id)
        .filter((trade) => !isMockBrokerTrade(trade, this.deps.brokerAccounts)),
    );

    const apiLog = sessions.flatMap((session) =>
      this.deps.apiCallLog.listByScope({ sessionId: session.id }),
    );
    const totalAiSpendUsd = apiLog
      .filter((e) => e.call_type === "ai")
      .reduce((sum, e) => sum + (e.cost_usd ?? 0), 0);
    const totalDataSpendUsd = apiLog
      .filter((e) => e.call_type === "data")
      .reduce((sum, e) => sum + (e.cost_usd ?? 0), 0);

    const promotionTier = resolveExperiencePromotionTier(
      sessions,
      this.deps.brokerAccounts,
      this.deps.brokerAssignments,
    );

    if (closedTrades.length === 0) {
      return emptyScorecard({
        experienceId,
        displayName,
        sessionCount: sessions.length,
        totalAiSpendUsd,
        totalDataSpendUsd,
        promotionTier,
      });
    }

    const wins = closedTrades.filter((t) => (t.final_pnl_usd ?? 0) > 0);
    const losses = closedTrades.filter((t) => (t.final_pnl_usd ?? 0) <= 0);
    const winCount = wins.length;
    const lossCount = losses.length;
    const tradeCount = closedTrades.length;
    const winRate = winCount / tradeCount;
    const lossRate = 1 - winRate;

    const grossWins = wins.reduce((sum, t) => sum + (t.final_pnl_usd ?? 0), 0);
    const grossLosses = Math.abs(
      losses.reduce((sum, t) => sum + (t.final_pnl_usd ?? 0), 0),
    );
    const avgWinUsd = winCount > 0 ? grossWins / winCount : 0;
    const avgLossUsd = lossCount > 0 ? grossLosses / lossCount : 0;
    const expectancy = winRate * avgWinUsd - lossRate * avgLossUsd;

    const netPnlUsd = closedTrades.reduce(
      (sum, t) => sum + (t.final_pnl_usd ?? 0),
      0,
    );
    const netPnlAfterCostsUsd = netPnlUsd - totalAiSpendUsd - totalDataSpendUsd;
    const costPerTradeUsd = (totalAiSpendUsd + totalDataSpendUsd) / tradeCount;

    const { maxDrawdownPct } = computeMaxDrawdown(closedTrades);
    const avgHoldHours = computeAvgHoldHours(closedTrades);

    const sessionScorecard: TradeScorecard = {
      sessionId: sessions[0]?.id ?? experienceId,
      strategyPresetLabel: displayName,
      generatedAt: new Date().toISOString(),
      tradeCount,
      winCount,
      lossCount,
      winRate,
      avgWinUsd,
      avgLossUsd,
      expectancy,
      profitFactor: grossLosses === 0 ? Infinity : grossWins / grossLosses,
      netPnlUsd,
      netPnlAfterCostsUsd,
      totalAiSpendUsd,
      totalDataSpendUsd,
      maxDrawdownUsd: 0,
      maxDrawdownPct,
      tradeFrequency: 0,
      avgHoldHours,
      exitReasonBreakdown: {},
      rejectionReasonBreakdown: {},
      scenarioCoverage: {},
    };

    const promotion =
      promotionTier === "paper"
        ? meetsPromotionCriteria(sessionScorecard)
        : { meets: false, failedCriteria: ["not_paper_tier"] };

    return {
      experienceId,
      displayName,
      sessionCount: sessions.length,
      tradeCount,
      winCount,
      lossCount,
      winRate,
      expectancy,
      maxDrawdownPct,
      netPnlUsd,
      netPnlAfterCostsUsd,
      totalAiSpendUsd,
      totalDataSpendUsd,
      costPerTradeUsd,
      avgHoldHours,
      promotionTier,
      meetsPromotion: promotion.meets,
      failedPromotionCriteria: promotion.failedCriteria,
      generatedAt: new Date().toISOString(),
    };
  }
}

function resolveExperiencePromotionTier(
  sessions: Array<{ id: string; executionMode: string }>,
  brokerAccounts: BrokerAccountsRepo,
  brokerAssignments: SessionBrokerAssignmentsRepo,
): PromotionTier {
  if (sessions.length === 0) return "scripted";
  const tiers = sessions.map((session) => {
    const assignedIds = brokerAssignments.listBrokerAccountIds(session.id);
    const assignedAccounts = assignedIds
      .map((id) => brokerAccounts.find(id))
      .filter(Boolean);
    const mockAccount = assignedAccounts.find((a) => a?.brokerType === "mock");
    const usesMock = Boolean(mockAccount);
    return resolveSessionPromotionTier({
      executionMode: session.executionMode as "paper_only" | "live_allowed",
      usesMockBroker: usesMock,
      mockExecutionTier: mockAccount?.mockExecutionTier ?? null,
    });
  });
  const rank: Record<PromotionTier, number> = {
    scripted: 0,
    rehearsal: 1,
    paper: 2,
    live: 3,
  };
  return tiers.reduce(
    (best, tier) => (rank[tier] > rank[best] ? tier : best),
    "scripted" as PromotionTier,
  );
}

function isMockBrokerTrade(
  trade: Trade,
  brokerAccounts: BrokerAccountsRepo,
): boolean {
  if (!trade.brokerAccountId) return false;
  const account = brokerAccounts.find(trade.brokerAccountId);
  return account?.brokerType === "mock";
}

function computeMaxDrawdown(trades: Trade[]): { maxDrawdownPct: number } {
  let peak = 0;
  let maxDrawdown = 0;
  let cumPnl = 0;
  for (const trade of trades) {
    cumPnl += trade.final_pnl_usd ?? 0;
    if (cumPnl > peak) peak = cumPnl;
    const drawdown = peak - cumPnl;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;
  }
  return { maxDrawdownPct: peak > 0 ? maxDrawdown / peak : 0 };
}

function computeAvgHoldHours(trades: Trade[]): number {
  const withTimestamps = trades.filter(
    (t): t is Trade & { opened_at: string; closed_at: string } =>
      Boolean(t.opened_at && t.closed_at),
  );
  if (withTimestamps.length === 0) return 0;
  const totalHoldMs = withTimestamps.reduce(
    (sum, t) =>
      sum + (new Date(t.closed_at).getTime() - new Date(t.opened_at).getTime()),
    0,
  );
  return totalHoldMs / withTimestamps.length / (1000 * 60 * 60);
}

function emptyScorecard(input: {
  experienceId: string;
  displayName: string;
  sessionCount: number;
  totalAiSpendUsd: number;
  totalDataSpendUsd: number;
  promotionTier: PromotionTier;
}): ExperienceScorecard {
  return {
    experienceId: input.experienceId,
    displayName: input.displayName,
    sessionCount: input.sessionCount,
    tradeCount: 0,
    winCount: 0,
    lossCount: 0,
    winRate: 0,
    expectancy: 0,
    maxDrawdownPct: 0,
    netPnlUsd: 0,
    netPnlAfterCostsUsd: -(input.totalAiSpendUsd + input.totalDataSpendUsd),
    totalAiSpendUsd: input.totalAiSpendUsd,
    totalDataSpendUsd: input.totalDataSpendUsd,
    costPerTradeUsd: 0,
    avgHoldHours: 0,
    promotionTier: input.promotionTier,
    meetsPromotion: false,
    failedPromotionCriteria: ["minTradeCount"],
    generatedAt: new Date().toISOString(),
  };
}
