import type { SessionRepo } from "../../db/repositories/sessions/session-repo";
import type { TradesRepo } from "../../db/repositories/trades/trades-repo";
import type { SessionService } from "../session/session-service";
import type { LiveReadinessService } from "../risk/live-readiness-service";
import type { SupervisorService } from "../supervisor/supervisor-service";
import type { EventBus } from "../infra/event-bus";
import type { BrokerService } from "../broker/broker-service";
import type { CapitalReservationService } from "../risk/capital-reservation-service";
import { runWithProviderCallScopeAsync } from "../infra/provider-call-log";

export interface KillSwitchGauge {
  sessionId: string;
  sessionName: string;
  status: string;
  dailyPnlUsd: number;
  dailyLossLimitUsd: number;
  drawdownFraction: number;
  maxDrawdownFraction: number;
  liveReadiness: {
    readyToStart: boolean;
    acknowledgedAt: string | null;
  } | null;
}

export interface FlattenResult {
  closed: string[];
  failed: Array<{ tradeId: string; error: string }>;
}

/**
 * Kill-switch panel backend: pause-all, per-session kill, gauges, flatten
 * through the normal gate/close chain (finish-line 08 T7).
 */
export class KillSwitchService {
  constructor(
    private readonly deps: {
      sessions: SessionRepo;
      trades: TradesRepo;
      sessionService: SessionService;
      liveReadiness: LiveReadinessService;
      supervisor: SupervisorService;
      eventBus: EventBus;
      broker: BrokerService;
      capitalReservation: CapitalReservationService;
      loadGauges: () => KillSwitchGauge[];
    },
  ) {}

  async pauseAll(): Promise<{ paused: string[]; skipped: string[] }> {
    const active = this.deps.sessions.listByStatuses([
      "active",
      "attention_required",
      "monitoring_only",
    ]);
    const paused: string[] = [];
    const skipped: string[] = [];
    for (const session of active) {
      try {
        await this.deps.sessionService.pause(session.id);
        paused.push(session.id);
      } catch (err) {
        skipped.push(session.id);
        this.deps.eventBus.emit("notification", {
          title: "Pause-all skip",
          body: `${session.name}: ${err instanceof Error ? err.message : String(err)}`,
          level: "WARN",
        });
      }
    }
    this.deps.eventBus.emit("notification", {
      title: "Pause all",
      body: `Paused ${paused.length} session(s); skipped ${skipped.length}.`,
      level: "WARN",
    });
    return { paused, skipped };
  }

  async killSession(sessionId: string): Promise<{ status: string }> {
    await this.deps.sessionService.pause(sessionId);
    await this.deps.supervisor.raiseDailyLoss(
      sessionId,
      `Operator kill-switch paused session ${sessionId}`,
    );
    return { status: this.deps.sessionService.getStatus(sessionId) };
  }

  gauges(): KillSwitchGauge[] {
    return this.deps.loadGauges();
  }

  /**
   * Flatten everything: market-close every open position through the normal
   * closeOrder path (same as trades:force-close). Requires typed confirm.
   */
  async flattenAll(confirmation: string): Promise<FlattenResult> {
    if (confirmation !== "FLATTEN") {
      throw new Error("Type FLATTEN to confirm flatten-everything.");
    }
    const open = this.deps.trades.listOpenAndPending();
    const closed: string[] = [];
    const failed: Array<{ tradeId: string; error: string }> = [];

    for (const trade of open) {
      try {
        let pnl = 0;
        if (trade.broker_order_id && trade.brokerAccountId) {
          const brokerAccountId = trade.brokerAccountId;
          const brokerOrderId = trade.broker_order_id;
          const result = await runWithProviderCallScopeAsync(
            {
              sessionId: trade.sessionId ?? null,
              tradeId: trade.id,
            },
            () => this.deps.broker.closeOrder(brokerAccountId, brokerOrderId),
          );
          pnl = result.realizedPnlUsd;
        }
        const updated = this.deps.trades.updateStatus(trade.id, "closed", pnl);
        this.deps.capitalReservation.releaseOnClose(trade.id);
        this.deps.eventBus.emit("trade_closed", updated);
        closed.push(trade.id);
      } catch (err) {
        failed.push({
          tradeId: trade.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    this.deps.eventBus.emit("notification", {
      title: "Flatten everything",
      body: `Closed ${closed.length}; failed ${failed.length}.`,
      level: failed.length > 0 ? "ERROR" : "WARN",
    });
    return { closed, failed };
  }
}
