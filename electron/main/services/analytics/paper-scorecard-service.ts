import type { Trade } from "@/lib/types";
import type { MockScenarioKind } from "@electron/shared/domain/mock-scenario";
import { safeJsonParse } from "../infra/safe-json-parse";
import type { ApiCallLogRepo } from "../../db/repositories/system/api-call-log-repo";
import type { BrokerAccountsRepo } from "../../db/repositories/brokers/broker-accounts-repo";
import type { TradesRepo } from "../../db/repositories/trades/trades-repo";
import type { SessionRepo } from "../../db/repositories/sessions/session-repo";
import type { SqliteSessionExecutionStepsRepo } from "../../db/repositories/sessions/session-execution-steps-repo";

export interface TradeScorecard {
  sessionId: string;
  strategyPresetLabel: string;
  generatedAt: string;
  tradeCount: number;
  winCount: number;
  lossCount: number;
  winRate: number;
  avgWinUsd: number;
  avgLossUsd: number;
  expectancy: number;
  profitFactor: number;
  netPnlUsd: number;
  netPnlAfterCostsUsd: number;
  totalAiSpendUsd: number;
  totalDataSpendUsd: number;
  maxDrawdownUsd: number;
  maxDrawdownPct: number;
  tradeFrequency: number;
  avgHoldHours: number;
  exitReasonBreakdown: Record<string, number>;
  rejectionReasonBreakdown: Record<string, number>;
  scenarioCoverage: Partial<Record<MockScenarioKind, number>>;
}

export interface PromotionThresholds {
  minTradeCount: number;
  minWinRate: number;
  minExpectancy: number;
  maxDrawdownPct: number;
  requiredScenarioCoverage: MockScenarioKind[];
}

const DEFAULT_THRESHOLDS: PromotionThresholds = {
  minTradeCount: 100,
  minWinRate: 0.4,
  minExpectancy: 0.0,
  maxDrawdownPct: 0.2,
  requiredScenarioCoverage: [],
};

export function meetsPromotionCriteria(
  scorecard: TradeScorecard,
  thresholds: PromotionThresholds = DEFAULT_THRESHOLDS,
): { meets: boolean; failedCriteria: string[] } {
  const failedCriteria: string[] = [];

  if (scorecard.tradeCount < thresholds.minTradeCount) {
    failedCriteria.push("minTradeCount");
  }
  if (scorecard.winRate < thresholds.minWinRate) {
    failedCriteria.push("minWinRate");
  }
  if (scorecard.expectancy < thresholds.minExpectancy) {
    failedCriteria.push("minExpectancy");
  }
  if (scorecard.maxDrawdownPct > thresholds.maxDrawdownPct) {
    failedCriteria.push("maxDrawdownPct");
  }
  for (const scenario of thresholds.requiredScenarioCoverage) {
    if (!scorecard.scenarioCoverage[scenario]) {
      failedCriteria.push(scenario);
    }
  }

  return { meets: failedCriteria.length === 0, failedCriteria };
}

interface PaperScorecardServiceDeps {
  trades: TradesRepo;
  brokerAccounts: BrokerAccountsRepo;
  apiCallLog: ApiCallLogRepo;
  session: SessionRepo;
  sessionExecutionSteps: SqliteSessionExecutionStepsRepo;
}

export class PaperScorecardService {
  constructor(private readonly deps: PaperScorecardServiceDeps) {}

  generate(sessionId: string): TradeScorecard {
    const closedTrades = this.deps.trades
      .listClosed(sessionId)
      .filter((trade) => !isMockBrokerTrade(trade, this.deps.brokerAccounts));

    const session = this.deps.session.get(sessionId);
    const strategyPresetLabel = session?.name ?? sessionId;

    const apiLog = this.deps.apiCallLog.listByScope({ sessionId });
    const totalAiSpendUsd = apiLog
      .filter((e) => e.call_type === "ai")
      .reduce((sum, e) => sum + (e.cost_usd ?? 0), 0);
    const totalDataSpendUsd = apiLog
      .filter((e) => e.call_type === "data")
      .reduce((sum, e) => sum + (e.cost_usd ?? 0), 0);

    const rejectionReasonBreakdown: Record<string, number> = {};
    const steps = this.deps.sessionExecutionSteps.getLatestBySession(sessionId);
    for (const step of steps) {
      if (step.status === "failed" && step.lastErrorCode) {
        rejectionReasonBreakdown[step.lastErrorCode] =
          (rejectionReasonBreakdown[step.lastErrorCode] ?? 0) + 1;
      }
    }

    if (closedTrades.length === 0) {
      return {
        sessionId,
        strategyPresetLabel,
        generatedAt: new Date().toISOString(),
        tradeCount: 0,
        winCount: 0,
        lossCount: 0,
        winRate: 0,
        avgWinUsd: 0,
        avgLossUsd: 0,
        expectancy: 0,
        profitFactor: 0,
        netPnlUsd: 0,
        netPnlAfterCostsUsd: -(totalAiSpendUsd + totalDataSpendUsd),
        totalAiSpendUsd,
        totalDataSpendUsd,
        maxDrawdownUsd: 0,
        maxDrawdownPct: 0,
        tradeFrequency: 0,
        avgHoldHours: 0,
        exitReasonBreakdown: {},
        rejectionReasonBreakdown,
        scenarioCoverage: {},
      };
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
    const profitFactor = grossLosses === 0 ? Infinity : grossWins / grossLosses;

    const netPnlUsd = closedTrades.reduce(
      (sum, t) => sum + (t.final_pnl_usd ?? 0),
      0,
    );
    const netPnlAfterCostsUsd = netPnlUsd - totalAiSpendUsd - totalDataSpendUsd;

    const { maxDrawdownUsd, maxDrawdownPct } = computeMaxDrawdown(closedTrades);

    const { tradeFrequency, avgHoldHours } = computeTimeStats(closedTrades);

    const exitReasonBreakdown: Record<string, number> = {};
    for (const t of closedTrades) {
      if (t.exit_reason) {
        exitReasonBreakdown[t.exit_reason] =
          (exitReasonBreakdown[t.exit_reason] ?? 0) + 1;
      }
    }

    const scenarioCoverage: Partial<Record<MockScenarioKind, number>> = {};
    for (const t of closedTrades) {
      const kind = readMockScenarioKind(t);
      if (kind) scenarioCoverage[kind] = (scenarioCoverage[kind] ?? 0) + 1;
    }

    return {
      sessionId,
      strategyPresetLabel,
      generatedAt: new Date().toISOString(),
      tradeCount,
      winCount,
      lossCount,
      winRate,
      avgWinUsd,
      avgLossUsd,
      expectancy,
      profitFactor,
      netPnlUsd,
      netPnlAfterCostsUsd,
      totalAiSpendUsd,
      totalDataSpendUsd,
      maxDrawdownUsd,
      maxDrawdownPct,
      tradeFrequency,
      avgHoldHours,
      exitReasonBreakdown,
      rejectionReasonBreakdown,
      scenarioCoverage,
    };
  }
}

function isMockBrokerTrade(
  trade: Trade,
  brokerAccounts: BrokerAccountsRepo,
): boolean {
  if (!trade.brokerAccountId) return false;
  const account = brokerAccounts.find(trade.brokerAccountId);
  return account?.brokerType === "mock";
}

function readMockScenarioKind(trade: Trade): MockScenarioKind | null {
  if (!trade.instrumentMetadataJson) return null;
  const parsed = safeJsonParse<{ mockScenarioKind?: string }>(
    trade.instrumentMetadataJson,
    undefined,
    "paper-scorecard.mockScenarioKind",
  );
  const kind = parsed?.mockScenarioKind;
  if (!kind) return null;
  const validKinds: MockScenarioKind[] = [
    "clean_breakout",
    "failed_breakout",
    "sideways_chop",
    "gap_down_after_entry",
    "news_reversal",
    "stale_quote",
    "wide_spread",
    "partial_fill",
    "broker_reject",
    "rate_limit",
  ];
  return validKinds.includes(kind as MockScenarioKind)
    ? (kind as MockScenarioKind)
    : null;
}

function computeMaxDrawdown(trades: Trade[]): {
  maxDrawdownUsd: number;
  maxDrawdownPct: number;
} {
  let peak = 0;
  let maxDrawdown = 0;
  let cumPnl = 0;
  for (const trade of trades) {
    cumPnl += trade.final_pnl_usd ?? 0;
    if (cumPnl > peak) peak = cumPnl;
    const drawdown = peak - cumPnl;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;
  }
  const maxDrawdownPct = peak > 0 ? maxDrawdown / peak : 0;
  return { maxDrawdownUsd: maxDrawdown, maxDrawdownPct };
}

function computeTimeStats(trades: Trade[]): {
  tradeFrequency: number;
  avgHoldHours: number;
} {
  const withTimestamps = trades.filter(
    (t): t is Trade & { opened_at: string; closed_at: string } =>
      Boolean(t.opened_at && t.closed_at),
  );
  if (withTimestamps.length === 0)
    return { tradeFrequency: 0, avgHoldHours: 0 };

  const sorted = [...withTimestamps].sort(
    (a, b) => new Date(a.opened_at).getTime() - new Date(b.opened_at).getTime(),
  );

  const firstTrade = sorted[0];
  const lastTrade = sorted[sorted.length - 1];
  if (!firstTrade || !lastTrade) return { tradeFrequency: 0, avgHoldHours: 0 };
  const first = new Date(firstTrade.opened_at).getTime();
  const last = new Date(lastTrade.closed_at).getTime();
  const spanDays = (last - first) / (1000 * 60 * 60 * 24);
  const tradeFrequency = spanDays > 0 ? withTimestamps.length / spanDays : 0;

  const totalHoldMs = withTimestamps.reduce((sum, t) => {
    return (
      sum + (new Date(t.closed_at).getTime() - new Date(t.opened_at).getTime())
    );
  }, 0);
  const avgHoldHours = totalHoldMs / withTimestamps.length / (1000 * 60 * 60);

  return { tradeFrequency, avgHoldHours };
}
