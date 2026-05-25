import type { BrokerRegistry } from "../broker/broker-registry";
import type { CapitalReservationsRepo } from "../../db/repositories/trades/capital-reservations-repo";
import type { EventsRepo } from "../../db/repositories/system/events-repo";
import type { SessionExecutionStepsRepo } from "../../db/repositories/sessions/session-execution-steps-repo";
import type { SessionRepo } from "../../db/repositories/sessions/session-repo";
import type { TradeApprovalsRepo } from "../../db/repositories/trades/trade-approvals-repo";
import type { TradesRepo } from "../../db/repositories/trades/trades-repo";
import type { CapitalReservationService } from "../risk/capital-reservation-service";
import type { Logger } from "../infra/log";
import { countOpenTrades } from "./session-trade-state";

export interface SessionStartupRecoveryDeps {
  sessionRepo: SessionRepo;
  tradesRepo: TradesRepo;
  tradeApprovalsRepo: TradeApprovalsRepo;
  sessionExecutionStepsRepo: SessionExecutionStepsRepo;
  capitalReservationsRepo: CapitalReservationsRepo;
  capitalReservation: CapitalReservationService;
  brokerRegistry: BrokerRegistry;
  eventsRepo: EventsRepo;
  logger: Logger;
}

export interface RecoverableSession {
  sessionId: string;
  priorStatus: "active" | "paused" | "stopped" | "monitoring_only";
  demoteToPaused: boolean;
  safetyRecovery: boolean;
}

export class SessionStartupRecoveryService {
  constructor(private readonly deps: SessionStartupRecoveryDeps) {}

  collectRecoverableSessions(): RecoverableSession[] {
    const recoverable: RecoverableSession[] = [];

    for (const session of this.deps.sessionRepo.listByStatuses(["active"])) {
      recoverable.push({
        sessionId: session.id,
        priorStatus: "active",
        demoteToPaused: true,
        safetyRecovery: false,
      });
    }

    for (const session of this.deps.sessionRepo.listByStatuses(["paused"])) {
      recoverable.push({
        sessionId: session.id,
        priorStatus: "paused",
        demoteToPaused: false,
        safetyRecovery: false,
      });
    }

    for (const session of this.deps.sessionRepo.listByStatuses([
      "monitoring_only",
    ])) {
      recoverable.push({
        sessionId: session.id,
        priorStatus: "monitoring_only",
        demoteToPaused: false,
        safetyRecovery: false,
      });
    }

    for (const session of this.deps.sessionRepo.listByStatuses(["stopped"])) {
      const openTradeCount = countOpenTrades(this.deps.tradesRepo, session.id);
      if (openTradeCount === 0) continue;
      recoverable.push({
        sessionId: session.id,
        priorStatus: "stopped",
        demoteToPaused: true,
        safetyRecovery: true,
      });
    }

    return recoverable;
  }

  async recoverSession(sessionId: string, input: RecoverableSession): Promise<void> {
    const startedAt = Date.now();
    const openTradeCount = countOpenTrades(this.deps.tradesRepo, sessionId);

    if (input.demoteToPaused) {
      this.deps.sessionRepo.setStatus("paused", sessionId);
    }

    if (input.safetyRecovery) {
      this.deps.eventsRepo.insert({
        session_id: sessionId,
        trade_id: null,
        level: "WARN",
        agent_type: "session",
        message: `Startup safety recovery: session had ${openTradeCount} open trade(s) while stopped; rehydrated as paused so exits stay managed.`,
      });
      this.deps.logger.warn(
        { sessionId, openTradeCount },
        "startup recovery: rehydrating stopped session with open trades as paused",
      );
    } else if (input.priorStatus === "active") {
      this.deps.logger.warn(
        { sessionId },
        "startup rehydration: demoting previously-active session to paused (monitor stays live for open positions)",
      );
    }

    const reconcile = await this.reconcileOpenTrades(sessionId);
    const repairedSteps = this.repairStaleRunningSteps(sessionId);
    const releasedReservations = this.auditCapitalReservations(sessionId);

    this.deps.logger.info(
      {
        sessionId,
        openTradeCount,
        reconciledTrades: reconcile.reconciled,
        reconcileWarnings: reconcile.warnings.length,
        repairedSteps,
        releasedReservations,
        durationMs: Date.now() - startedAt,
      },
      "startup session recovery complete",
    );
  }

  async reconcileOpenTrades(
    sessionId: string,
  ): Promise<{ reconciled: number; warnings: string[] }> {
    const openTrades = this.deps.tradesRepo
      .listOpenAndPending(sessionId)
      .filter((trade) => trade.status === "open");
    const warnings: string[] = [];
    let reconciled = 0;

    for (const trade of openTrades) {
      if (!trade.broker_order_id || !trade.brokerAccountId) {
        warnings.push(
          `Trade ${trade.instrumentSymbol} (${trade.id}) missing broker order metadata; monitor will retry.`,
        );
        continue;
      }

      try {
        const adapter = await this.deps.brokerRegistry.get(trade.brokerAccountId);
        const status = await adapter.getOrderStatus(trade.broker_order_id);
        if (status.status === "closed") {
          this.deps.tradesRepo.updateStatus(
            trade.id,
            "closed",
            status.realizedPnlUsd ?? 0,
            "broker_closed",
          );
          this.deps.capitalReservation.releaseOnClose(trade.id);
          reconciled += 1;
          this.deps.logger.info(
            { sessionId, tradeId: trade.id, brokerStatus: status.status },
            "startup reconciliation closed local trade from broker truth",
          );
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        warnings.push(
          `Could not reconcile ${trade.instrumentSymbol} (${trade.id}): ${message}`,
        );
        this.deps.logger.warn(
          { sessionId, tradeId: trade.id, err: error },
          "startup trade reconciliation failed for open trade",
        );
      }
    }

    for (const warning of warnings) {
      this.deps.eventsRepo.insert({
        session_id: sessionId,
        trade_id: null,
        level: "WARN",
        agent_type: "session",
        message: warning,
      });
    }

    return { reconciled, warnings };
  }

  repairStaleRunningSteps(sessionId: string): number {
    const { cycleId, steps } =
      this.deps.sessionExecutionStepsRepo.getLatestCycleState(sessionId);
    if (!cycleId) return 0;

    let repaired = 0;
    for (const step of steps) {
      if (step.status !== "running") continue;
      this.deps.sessionExecutionStepsRepo.upsert({
        sessionId,
        cycleId,
        stage: step.stage,
        status: "failed",
        attempt: step.attempt,
        startedAt: step.startedAt,
        completedAt: new Date().toISOString(),
        nextRetryAt: null,
        lastErrorCode: "process_killed",
        lastErrorMessage: "Execution interrupted by process shutdown.",
        outcome: "transient",
        retryable: true,
      });
      repaired += 1;
    }

    if (repaired > 0) {
      this.deps.logger.warn(
        { sessionId, cycleId, repairedSteps: repaired },
        "startup recovery repaired stale running execution steps",
      );
    }

    return repaired;
  }

  auditCapitalReservations(sessionId: string): number {
    const openTradeIds = new Set(
      this.deps.tradesRepo
        .listOpenAndPending(sessionId)
        .map((trade) => trade.id),
    );
    const pendingApprovalIds = new Set(
      this.deps.tradeApprovalsRepo
        .listPending()
        .filter((approval) => approval.sessionId === sessionId)
        .map((approval) => approval.id),
    );

    let released = 0;
    for (const reservation of this.deps.capitalReservation.listActiveBySession(
      sessionId,
    )) {
      const linkedToOpenTrade =
        reservation.tradeId != null && openTradeIds.has(reservation.tradeId);
      const linkedToPendingApproval =
        reservation.approvalId != null &&
        pendingApprovalIds.has(reservation.approvalId);

      if (linkedToOpenTrade || linkedToPendingApproval) continue;

      if (reservation.approvalId) {
        this.deps.capitalReservation.releaseByApproval(reservation.approvalId);
      } else if (reservation.tradeId) {
        this.deps.capitalReservation.releaseOnFailure(reservation.tradeId);
      }
      released += 1;
    }

    if (released > 0) {
      this.deps.logger.warn(
        { sessionId, releasedReservations: released },
        "startup recovery released orphaned capital reservations",
      );
    }

    return released;
  }
}
