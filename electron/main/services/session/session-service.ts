import type { SessionStatus } from "@/lib/types";
import { AppError } from "@electron/shared/infra/errors";
import { canTransition } from "@electron/shared/domain";
import { countOpenTrades } from "./session-trade-state";
import { prepareForActivation } from "./prepare-for-activation";
import type { SessionLifecycleDeps } from "./session-types";

export interface PortfolioValueResult {
  value: number;
  source: "broker";
  brokerCount: number;
}

export class SessionService {
  constructor(private readonly deps: SessionLifecycleDeps) {}

  // Per-session lifecycle lock: start/pause/resume/stop/forceStop all read
  // session.status then mutate it. Without serialization, two overlapping
  // calls for the same session both read the stale pre-transition status and
  // both pass assertTransition — e.g. a pause() and a stop() racing produced
  // both "Session paused." and "Session stopped." events for one teardown
  // (docs/attic/reviews/2026-07-19-overnight-stress-session-review.md, secondary
  // problem 7). Chaining onto this map forces the second call to wait for
  // the first to commit its status before assertTransition runs.
  private readonly lifecycleLocks = new Map<string, Promise<unknown>>();

  private withLifecycleLock<T>(
    sessionId: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const prior = this.lifecycleLocks.get(sessionId) ?? Promise.resolve();
    const run = prior.then(fn, fn);
    this.lifecycleLocks.set(
      sessionId,
      run.then(
        () => undefined,
        () => undefined,
      ),
    );
    return run;
  }

  getStatus(sessionId?: string): SessionStatus {
    return this.deps.sessionRepo.getStatus(sessionId);
  }

  async start(
    sessionId = this.deps.sessionRepo.getFocusedSessionId(),
  ): Promise<SessionStatus> {
    return this.withLifecycleLock(sessionId, () => this.startImpl(sessionId));
  }

  private async startImpl(sessionId: string): Promise<SessionStatus> {
    const session = this.deps.sessionRepo.requireById(sessionId);
    if (
      session.status === "paused" ||
      session.status === "attention_required"
    ) {
      return this.resumeImpl(sessionId);
    }
    this.assertTransition(session.status, "active");

    await prepareForActivation({
      session,
      liveReadiness: this.deps.liveReadiness,
      preflight: this.deps.preflight,
      orchestratorDeps: this.deps.orchestratorDeps,
      emitSessionEvent: (id, level, message, agentType) =>
        this.emitSessionEvent(id, level, message, agentType),
      provisionHistory: this.deps.provisionHistory,
    });

    this.emitSessionEvent(sessionId, "INFO", "Session starting...", "session");
    try {
      await this.deps.runtimeManager.startSession(sessionId);
      this.emitSessionEvent(
        sessionId,
        "INFO",
        "Session runtime ready.",
        "session",
      );
      return this.getStatus(sessionId);
    } catch (error) {
      this.emitSessionEvent(
        sessionId,
        "ERROR",
        `Session failed to start: ${error instanceof Error ? error.message : String(error)}`,
        "session",
      );
      throw error;
    }
  }

  async pause(
    sessionId = this.deps.sessionRepo.getFocusedSessionId(),
  ): Promise<SessionStatus> {
    return this.withLifecycleLock(sessionId, () => this.pauseImpl(sessionId));
  }

  private async pauseImpl(sessionId: string): Promise<SessionStatus> {
    const session = this.deps.sessionRepo.requireById(sessionId);
    this.assertTransition(session.status, "paused");
    await this.deps.runtimeManager.pauseSession(sessionId);
    this.emitSessionEvent(sessionId, "INFO", "Session paused.", "session");
    return this.getStatus(sessionId);
  }

  async resume(
    sessionId = this.deps.sessionRepo.getFocusedSessionId(),
  ): Promise<SessionStatus> {
    return this.withLifecycleLock(sessionId, () => this.resumeImpl(sessionId));
  }

  private async resumeImpl(sessionId: string): Promise<SessionStatus> {
    const session = this.deps.sessionRepo.requireById(sessionId);
    this.assertTransition(session.status, "active");

    await prepareForActivation({
      session,
      liveReadiness: this.deps.liveReadiness,
      preflight: this.deps.preflight,
      orchestratorDeps: this.deps.orchestratorDeps,
      emitSessionEvent: (id, level, message, agentType) =>
        this.emitSessionEvent(id, level, message, agentType),
      provisionHistory: this.deps.provisionHistory,
    });

    await this.deps.runtimeManager.resumeSession(sessionId);
    this.deps.clearOrderHalt?.();
    this.emitSessionEvent(sessionId, "INFO", "Session resumed.", "session");
    return this.getStatus(sessionId);
  }

  async stop(
    sessionId = this.deps.sessionRepo.getFocusedSessionId(),
  ): Promise<SessionStatus> {
    return this.withLifecycleLock(sessionId, () => this.stopImpl(sessionId));
  }

  private async stopImpl(sessionId: string): Promise<SessionStatus> {
    const session = this.deps.sessionRepo.requireById(sessionId);
    const openTradeCount = countOpenTrades(this.deps.tradesRepo, sessionId);
    if (openTradeCount > 0) {
      this.assertTransition(session.status, "monitoring_only");
      await this.deps.runtimeManager.drainSession(sessionId);
      this.emitSessionEvent(
        sessionId,
        "INFO",
        `Stop requested with ${openTradeCount} open trade(s); session will stop automatically when flat.`,
        "session",
      );
      return this.getStatus(sessionId);
    }
    this.assertTransition(session.status, "stopped");
    await this.deps.runtimeManager.stopSession(sessionId);
    this.emitSessionEvent(sessionId, "INFO", "Session stopped.", "session");
    return this.getStatus(sessionId);
  }

  async forceStop(
    sessionId = this.deps.sessionRepo.getFocusedSessionId(),
  ): Promise<SessionStatus> {
    return this.withLifecycleLock(sessionId, () =>
      this.forceStopImpl(sessionId),
    );
  }

  private async forceStopImpl(sessionId: string): Promise<SessionStatus> {
    const session = this.deps.sessionRepo.requireById(sessionId);
    const openTradeCount = countOpenTrades(this.deps.tradesRepo, sessionId);
    this.assertTransition(session.status, "stopped");
    await this.deps.runtimeManager.stopSession(sessionId);
    const message =
      openTradeCount > 0
        ? `Session force-stopped with ${openTradeCount} open trade(s); automated exits are no longer managed.`
        : "Session stopped.";
    this.emitSessionEvent(
      sessionId,
      openTradeCount > 0 ? "WARN" : "INFO",
      message,
      "session",
    );
    return this.getStatus(sessionId);
  }

  async getPortfolioValue(sessionId?: string): Promise<PortfolioValueResult> {
    const resolvedSessionId =
      sessionId ?? this.deps.sessionRepo.getFocused()?.id ?? null;
    if (!resolvedSessionId) {
      return { value: 0, source: "broker", brokerCount: 0 };
    }
    const assignedIds =
      this.deps.sessionBrokerAssignmentsRepo?.listBrokerAccountIds(
        resolvedSessionId,
      ) ?? [];

    if (
      this.deps.brokerRegistry &&
      this.deps.brokerBalanceCache &&
      assignedIds.length > 0
    ) {
      let total = 0;
      let counted = 0;
      for (const id of assignedIds) {
        try {
          const adapter = await this.deps.brokerRegistry.get(id);
          if (!adapter.launchCapable || adapter.brokerType === "mock") {
            continue;
          }
          total += await this.deps.brokerBalanceCache.getBalance(id);
          counted += 1;
        } catch (error) {
          // Per-broker: one unreachable adapter must not zero the portfolio sum.
          this.deps.orchestratorDeps.logger.warn(
            {
              brokerAccountId: id,
              err: error instanceof Error ? error.message : String(error),
            },
            "portfolio value: broker balance unavailable; skipping account",
          );
        }
      }
      return { value: total, source: "broker", brokerCount: counted };
    }
    return { value: 0, source: "broker", brokerCount: 0 };
  }

  uptimeMin(sessionId = this.deps.sessionRepo.getFocusedSessionId()): number {
    const runtime = this.deps.runtimeManager.get(sessionId);
    if (!runtime) return 0;
    const startedAtMs = Date.parse(runtime.startedAt);
    if (Number.isNaN(startedAtMs)) return 0;
    return Math.max(0, Math.round((Date.now() - startedAtMs) / 60000));
  }

  private assertTransition(from: SessionStatus, to: SessionStatus): void {
    if (!canTransition(from, to)) {
      throw new AppError(
        `Cannot transition session from ${from} to ${to}`,
        "INVALID_TRANSITION",
        {
          from,
          to,
        },
      );
    }
  }

  private emitSessionEvent(
    sessionId: string,
    level: "INFO" | "WARN" | "ERROR",
    message: string,
    agentType: "session" | "preflight",
  ): void {
    this.deps.eventsRepo.insert({
      session_id: sessionId,
      trade_id: null,
      level,
      agent_type: agentType,
      message,
    });
  }
}
