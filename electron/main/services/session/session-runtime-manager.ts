import { AppError } from "@electron/shared/errors";
import { SessionRuntime } from "./session-runtime";
import type { ApprovalRecheckInput, OrchestratorDeps, SessionRuntimeManagerDeps } from "./session-types";

export class SessionRuntimeManager {
  private readonly runtimes = new Map<string, SessionRuntime>();

  constructor(private readonly deps: SessionRuntimeManagerDeps) {}

  async startSession(sessionId: string): Promise<SessionRuntime> {
    const existing = this.runtimes.get(sessionId);
    if (existing) return existing;

    const session = this.deps.sessionRepo.requireById(sessionId);
    const orchestratorDeps: OrchestratorDeps = {
      sessionRepo: this.deps.sessionRepo,
      tradesRepo: this.deps.tradesRepo,
      agentRunsRepo: this.deps.agentRunsRepo,
      eventsRepo: this.deps.eventsRepo,
      statsRepo: this.deps.statsRepo,
      ai: this.deps.ai,
      broker: this.deps.broker,
      riskEngine: this.deps.riskEngine,
      bus: this.deps.bus,
      logger: this.deps.logger,
    };

    const runtime = new SessionRuntime(
      sessionId,
      this.deps.createOrchestrator(sessionId, orchestratorDeps),
      this.deps.createTradeMonitor(sessionId),
    );

    this.runtimes.set(sessionId, runtime);
    this.deps.bus.setRuntimeStatus(sessionId, session.status === "paused" ? "paused" : "active");
    this.deps.sessionRepo.setStatus(session.status === "paused" ? "paused" : "active", sessionId);

    try {
      await runtime.initialize(session.status === "paused" ? "paused" : "active");
      return runtime;
    } catch (error) {
      this.runtimes.delete(sessionId);
      this.deps.bus.clearRuntimeStatus(sessionId);
      throw error;
    }
  }

  async pauseSession(sessionId: string): Promise<void> {
    const runtime = this.requireRuntime(sessionId);
    this.deps.bus.setRuntimeStatus(sessionId, "paused");
    this.deps.sessionRepo.setStatus("paused", sessionId);
    await runtime.pause();
  }

  async resumeSession(sessionId: string): Promise<void> {
    const runtime = this.runtimes.get(sessionId) ?? (await this.startSession(sessionId));
    this.deps.bus.setRuntimeStatus(sessionId, "active");
    this.deps.sessionRepo.setStatus("active", sessionId);
    await runtime.resume();
  }

  async stopSession(sessionId: string): Promise<void> {
    const runtime = this.requireRuntime(sessionId);
    this.deps.bus.setRuntimeStatus(sessionId, "stopping");
    this.deps.sessionRepo.setStatus("stopped", sessionId);
    await runtime.stop();
    this.runtimes.delete(sessionId);
    this.deps.bus.clearRuntimeStatus(sessionId);
  }

  get(sessionId: string): SessionRuntime | null {
    return this.runtimes.get(sessionId) ?? null;
  }

  listActive(): SessionRuntime[] {
    return [...this.runtimes.values()];
  }

  async rehydrateFromDb(): Promise<void> {
    const sessions = this.deps.sessionRepo.listByStatuses(["active", "paused"]);
    for (const session of sessions) {
      await this.startSession(session.id);
    }
  }

  async enqueueApprovalRecheck(input: ApprovalRecheckInput): Promise<void> {
    const runtime = this.requireRuntime(input.sessionId);
    await runtime.orchestrator.runApprovalRecheck(input);
  }

  private requireRuntime(sessionId: string): SessionRuntime {
    const runtime = this.runtimes.get(sessionId);
    if (!runtime) {
      throw new AppError(`Runtime for session ${sessionId} is not active`, "SESSION_NOT_ACTIVE", { sessionId });
    }
    return runtime;
  }
}
