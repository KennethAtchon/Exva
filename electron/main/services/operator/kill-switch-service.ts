import type { SessionRepo } from "../../db/repositories/sessions/session-repo";
import type { TradesRepo } from "../../db/repositories/trades/trades-repo";
import type { Trade } from "@/lib/types";
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
  canceled: string[];
  failed: Array<{ tradeId: string; error: string }>;
  attentionRequired: string[];
  complete: boolean;
}

/**
 * Kill-switch panel backend: pause-all, per-session kill, gauges, flatten
 * through the emergency close chain (finish-line F0.5).
 *
 * Emergency policy: exits may skip the normal entry RiskEngine gate. Cancel
 * and liquidate still require broker identity, terminal confirmation, and
 * capital release only after reconciliation.
 *
 * Global order halt: pauseAll / flattenAll / killSession set a synchronous
 * halt flag checked immediately before broker submission. Operators clear it
 * by resuming any session ({@link clearHalt}).
 */
export class KillSwitchService {
  private halted = false;

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

  /** True while a kill-switch action has engaged the last-mile order gate. */
  isHalted(): boolean {
    return this.halted;
  }

  /** Clear the last-mile order halt (called when an operator resumes a session). */
  clearHalt(): void {
    this.halted = false;
  }

  private engageHalt(): void {
    this.halted = true;
  }

  async pauseAll(): Promise<{ paused: string[]; skipped: string[] }> {
    this.engageHalt();
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
    this.engageHalt();
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
   * Emergency flatten: fence intake (pause all) → cancel pending → liquidate
   * open → confirm terminal broker state → then DB close + capital release.
   * Idempotent and resumable: already-terminal DB trades are left alone;
   * broker failures leave trades open and flagged for attention.
   */
  async flattenAll(confirmation: string): Promise<FlattenResult> {
    if (confirmation !== "FLATTEN") {
      throw new Error("Type FLATTEN to confirm flatten-everything.");
    }

    // Fence new entries before touching live exposure.
    await this.pauseAll();

    const openAndPending = this.deps.trades.listOpenAndPending();
    const pending = openAndPending.filter((t) => t.status === "pending");
    const open = openAndPending.filter((t) => t.status === "open");

    const closed: string[] = [];
    const canceled: string[] = [];
    const failed: Array<{ tradeId: string; error: string }> = [];
    const attentionRequired: string[] = [];

    for (const trade of pending) {
      const result = await this.cancelPendingTrade(trade);
      if (result === "canceled") canceled.push(trade.id);
      else if (result === "attention") attentionRequired.push(trade.id);
      else if (result.error)
        failed.push({ tradeId: trade.id, error: result.error });
    }

    for (const trade of open) {
      const result = await this.liquidateOpenTrade(trade);
      if (result === "closed") closed.push(trade.id);
      else if (result === "attention") attentionRequired.push(trade.id);
      else if (result.error)
        failed.push({ tradeId: trade.id, error: result.error });
    }

    const complete =
      failed.length === 0 &&
      attentionRequired.length === 0 &&
      this.deps.trades.listOpenAndPending().length === 0;

    this.deps.eventBus.emit("notification", {
      title: "Flatten everything",
      body: complete
        ? `Complete: canceled ${canceled.length}, closed ${closed.length}.`
        : `Incomplete: canceled ${canceled.length}, closed ${closed.length}; failed ${failed.length}; attention ${attentionRequired.length}.`,
      level: complete ? "WARN" : "ERROR",
    });

    return { closed, canceled, failed, attentionRequired, complete };
  }

  private async cancelPendingTrade(
    trade: Trade,
  ): Promise<"canceled" | "attention" | { error: string }> {
    if (!trade.broker_order_id || !trade.brokerAccountId) {
      await this.raiseFlattenAttention(
        trade,
        "Pending trade missing broker identity; left open for operator review.",
      );
      return "attention";
    }

    const brokerAccountId = trade.brokerAccountId;
    const brokerOrderId = trade.broker_order_id;

    try {
      const prior = await runWithProviderCallScopeAsync(
        { sessionId: trade.sessionId ?? null, tradeId: trade.id },
        () => this.deps.broker.getOrderStatus(brokerAccountId, brokerOrderId),
      );
      if (prior.status === "open") {
        await runWithProviderCallScopeAsync(
          { sessionId: trade.sessionId ?? null, tradeId: trade.id },
          () => this.deps.broker.cancelOrder(brokerAccountId, brokerOrderId),
        );
      }

      const after = await this.deps.broker.getOrderStatus(
        brokerAccountId,
        brokerOrderId,
        { sessionId: trade.sessionId ?? null, tradeId: trade.id },
      );
      if (after.status === "open") {
        // Still working / open after cancel — do not falsify DB.
        await this.raiseFlattenAttention(
          trade,
          `Pending cancel not confirmed terminal (broker status=${after.status}).`,
        );
        return "attention";
      }

      const updated = this.deps.capitalReservation.runInTransaction(() => {
        const closed = this.deps.trades.updateStatus(
          trade.id,
          "closed",
          after.realizedPnlUsd ?? 0,
          "flatten_cancel",
        );
        this.deps.capitalReservation.releaseOnClose(trade.id);
        return closed;
      });
      this.deps.eventBus.emit("trade_closed", updated);
      return "canceled";
    } catch (err) {
      await this.raiseFlattenAttention(
        trade,
        err instanceof Error ? err.message : String(err),
      );
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }

  private async liquidateOpenTrade(
    trade: Trade,
  ): Promise<"closed" | "attention" | { error: string }> {
    if (!trade.broker_order_id || !trade.brokerAccountId) {
      await this.raiseFlattenAttention(
        trade,
        "Open trade missing broker identity; left open for operator review.",
      );
      return "attention";
    }

    const brokerAccountId = trade.brokerAccountId;
    const brokerOrderId = trade.broker_order_id;

    try {
      const prior = await this.deps.broker.getOrderStatus(
        brokerAccountId,
        brokerOrderId,
        { sessionId: trade.sessionId ?? null, tradeId: trade.id },
      );
      let pnl = prior.realizedPnlUsd ?? 0;

      if (prior.status === "open") {
        const result = await runWithProviderCallScopeAsync(
          { sessionId: trade.sessionId ?? null, tradeId: trade.id },
          () => this.deps.broker.closeOrder(brokerAccountId, brokerOrderId),
        );
        pnl = result.realizedPnlUsd;
      }

      const after = await this.deps.broker.getOrderStatus(
        brokerAccountId,
        brokerOrderId,
        { sessionId: trade.sessionId ?? null, tradeId: trade.id },
      );
      if (after.status === "open") {
        await this.raiseFlattenAttention(
          trade,
          `Liquidation not confirmed terminal (broker status=${after.status}).`,
        );
        return "attention";
      }

      const updated = this.deps.capitalReservation.runInTransaction(() => {
        const closed = this.deps.trades.updateStatus(
          trade.id,
          "closed",
          after.realizedPnlUsd ?? pnl,
          "flatten_close",
        );
        this.deps.capitalReservation.releaseOnClose(trade.id);
        return closed;
      });
      this.deps.eventBus.emit("trade_closed", updated);
      return "closed";
    } catch (err) {
      await this.raiseFlattenAttention(
        trade,
        err instanceof Error ? err.message : String(err),
      );
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }

  private async raiseFlattenAttention(
    trade: Trade,
    reason: string,
  ): Promise<void> {
    this.deps.eventBus.emit("notification", {
      title: "Flatten attention required",
      body: `${trade.id}: ${reason}`,
      level: "ERROR",
    });
    if (trade.sessionId) {
      try {
        await this.deps.supervisor.raiseDailyLoss(
          trade.sessionId,
          `Flatten incomplete for trade ${trade.id}: ${reason}`,
        );
      } catch {
        // Supervisor may already have raised; keep trade open either way.
      }
    }
  }
}
