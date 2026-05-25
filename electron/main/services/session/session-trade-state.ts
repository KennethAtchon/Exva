import type { TradesRepo } from "../../db/repositories/trades/trades-repo";
import type { TradingCycleContext } from "../orchestration/cycle/trading-cycle-context";

export function listOpenTrades(
  tradesRepo: TradesRepo,
  sessionId: string,
) {
  return tradesRepo
    .listOpenAndPending(sessionId)
    .filter((trade) => trade.status === "open");
}

export function hasAnyOpenTrade(
  tradesRepo: TradesRepo,
  sessionId: string,
): boolean {
  return listOpenTrades(tradesRepo, sessionId).length > 0;
}

export function countOpenTrades(
  tradesRepo: TradesRepo,
  sessionId: string,
): number {
  return listOpenTrades(tradesRepo, sessionId).length;
}

export function hasAnyBlockingTrade(
  tradesRepo: TradesRepo,
  sessionId: string,
): boolean {
  return tradesRepo.listOpenAndPending(sessionId).length > 0;
}

export function canScheduleSelector(ctx: TradingCycleContext): boolean {
  const { tradesRepo, logger } = ctx.deps;
  const { sessionId } = ctx;

  if (hasAnyOpenTrade(tradesRepo, sessionId)) {
    logger.info(
      { sessionId, openTradeCount: countOpenTrades(tradesRepo, sessionId) },
      "selector scheduling blocked: open trades remain",
    );
    return false;
  }

  const config = ctx.getSessionConfig();
  const blockingCount = tradesRepo.listOpenAndPending(sessionId).length;
  if (blockingCount >= config.max_concurrent_trades) {
    logger.info(
      { sessionId, blockingCount, maxConcurrentTrades: config.max_concurrent_trades },
      "selector scheduling blocked: trade capacity full",
    );
    return false;
  }

  return true;
}
