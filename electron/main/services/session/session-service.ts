import type { SessionStatus } from "@/lib/types";
import { AppError } from "@electron/shared/errors";
import { canTransition } from "@electron/shared/domain";
import type { SessionLifecycleDeps } from "./session-types";

export class SessionService {
  private readonly portfolioValue = 100000;

  constructor(private readonly deps: SessionLifecycleDeps) {}

  getStatus(sessionId?: string): SessionStatus {
    return this.deps.sessionRepo.getStatus(sessionId);
  }

  async start(sessionId = this.deps.sessionRepo.getFocusedSessionId()): Promise<SessionStatus> {
    const session = this.deps.sessionRepo.requireById(sessionId);
    if (session.status === "paused") {
      return this.resume(sessionId);
    }
    this.assertTransition(session.status, "active");

    if (session.executionMode === "live_allowed") {
      const readiness = await this.deps.liveReadiness.check(sessionId);
      if (!readiness.readyToStart) {
        const blockedBy = readiness.checks.filter((c) => !c.passed).map((c) => c.name);
        const message = `Live readiness gate failed: ${blockedBy.join(", ")}`;
        this.emitSessionEvent(sessionId, "ERROR", message, "preflight");
        throw new AppError(message, "VALIDATION_FAILED", { blockedBy, checks: readiness.checks });
      }
    }

    const preflight = await this.deps.preflight(session, this.deps.orchestratorDeps);
    if (!preflight.ok) {
      const fullMessage = `Preflight ${preflight.check} failed: ${preflight.message}`;
      this.emitSessionEvent(sessionId, "ERROR", fullMessage, "preflight");
      throw new AppError(fullMessage, preflight.code, preflight.details);
    }

    await this.deps.runtimeManager.startSession(sessionId);
    this.emitSessionEvent(sessionId, "INFO", "Session started.", "session");
    return this.getStatus(sessionId);
  }

  async pause(sessionId = this.deps.sessionRepo.getFocusedSessionId()): Promise<SessionStatus> {
    const session = this.deps.sessionRepo.requireById(sessionId);
    this.assertTransition(session.status, "paused");
    await this.deps.runtimeManager.pauseSession(sessionId);
    this.emitSessionEvent(sessionId, "INFO", "Session paused.", "session");
    return this.getStatus(sessionId);
  }

  async resume(sessionId = this.deps.sessionRepo.getFocusedSessionId()): Promise<SessionStatus> {
    const session = this.deps.sessionRepo.requireById(sessionId);
    this.assertTransition(session.status, "active");
    await this.deps.runtimeManager.resumeSession(sessionId);
    this.emitSessionEvent(sessionId, "INFO", "Session resumed.", "session");
    return this.getStatus(sessionId);
  }

  async stop(sessionId = this.deps.sessionRepo.getFocusedSessionId()): Promise<SessionStatus> {
    const session = this.deps.sessionRepo.requireById(sessionId);
    this.assertTransition(session.status, "stopped");
    await this.deps.runtimeManager.stopSession(sessionId);
    this.emitSessionEvent(sessionId, "INFO", "Session stopped.", "session");
    return this.getStatus(sessionId);
  }

  getPortfolioValue(): number {
    return this.portfolioValue;
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
      throw new AppError(`Cannot transition session from ${from} to ${to}`, "INVALID_TRANSITION", {
        from,
        to,
      });
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
