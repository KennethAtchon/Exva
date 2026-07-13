import type { WorkspaceSession } from "@/lib/types";
import type { TradesRepo } from "../../db/repositories/trades/trades-repo";
import type { TradingCycleContext } from "../orchestration/cycle/trading-cycle-context";
import { resolvePipelineIdForExperience } from "../../experiences";
import { requirePipelineDescriptor } from "../pipeline/implementations/registry/pipeline-descriptor-store";

function listOpenTrades(tradesRepo: TradesRepo, sessionId: string) {
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

/**
 * Whether a session's pipeline researches its own universe. This is the single
 * source of truth, derived from exactly one fact: does the pipeline declare any
 * selector workers. A session's pipeline is knowable only from its experience —
 * never from a signal source type.
 */
export function pipelineResearches(session: WorkspaceSession): boolean {
  const pipelineId = resolvePipelineIdForExperience(session.experienceId);
  const selectorWorkers =
    requirePipelineDescriptor(pipelineId).phaseWorkers.selector ?? [];
  return selectorWorkers.length > 0;
}

/**
 * Gate for AUTONOMOUS (trigger-less) selector cycles only. Signal-seeded cycles
 * never pass through here — they always run, since processing a signal is the
 * whole point of a signal pipeline. Attention/monitoring status is checked by
 * the individual call sites where it applies.
 */
export function canScheduleAutonomousSelector(
  ctx: TradingCycleContext,
): boolean {
  if (ctx.stopped || !ctx.runtimeIsActive()) return false;
  const session = ctx.deps.sessionRepo.requireById(ctx.sessionId);
  if (!pipelineResearches(session)) {
    ctx.deps.logger.info(
      { sessionId: ctx.sessionId },
      "autonomous selector skipped: pipeline has no selector workers",
    );
    return false;
  }
  return canScheduleSelector(ctx);
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

  const riskConfig = ctx.getStrategyContext().riskConfig;
  const blockingCount = tradesRepo.listOpenAndPending(sessionId).length;
  if (blockingCount >= riskConfig.maxConcurrentTrades) {
    logger.info(
      {
        sessionId,
        blockingCount,
        maxConcurrentTrades: riskConfig.maxConcurrentTrades,
      },
      "selector scheduling blocked: trade capacity full",
    );
    return false;
  }

  return true;
}
