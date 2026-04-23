import type { SessionStatus } from "@/lib/types";
import { secretKeys, type SecretsService } from "./secrets-service";
import type { BrokerService } from "./broker-service";
import type { RiskEngine } from "./risk-engine";
import type { SessionRepo } from "../db/repositories/session-repo";
import type { StatsRepo } from "../db/repositories/stats-repo";
import type { EventsRepo } from "../db/repositories/events-repo";
import type { EventBus } from "./event-bus";
import type { AgentOrchestrator } from "./agent-orchestrator";
import { AppError } from "@electron/shared/errors";

export interface SessionServiceDeps {
  sessionRepo: SessionRepo;
  statsRepo: StatsRepo;
  eventsRepo: EventsRepo;
  secrets: SecretsService;
  broker: BrokerService;
  risk: RiskEngine;
  eventBus: EventBus;
  getOrchestrator(): AgentOrchestrator;
}

export class SessionService {
  private readonly portfolioValue = 100000;

  constructor(private readonly deps: SessionServiceDeps) {}

  getStatus(): SessionStatus {
    const persisted = this.deps.sessionRepo.getStatus();
    return persisted === "active" ? "paused" : persisted;
  }

  async start(): Promise<SessionStatus> {
    const config = this.deps.sessionRepo.getConfig();
    const brokerTest = await this.deps.broker.testConnection();
    const stats = this.deps.statsRepo.dashboardStats(
      "active",
      this.portfolioValue,
      this.deps.sessionRepo.uptimeMin(),
      config.max_api_spend_usd,
    );
    const preflight = this.deps.risk.preflightSession({
      config,
      stats,
      brokerConnected: brokerTest.ok,
      aiKeyAvailable: await this.deps.secrets.has(secretKeys.anthropic),
    });

    if (!preflight.allowed) {
      this.emitSessionEvent("WARN", preflight.reason ?? "Session preflight failed");
      throw new AppError(preflight.reason ?? "Session preflight failed", "PREFLIGHT_FAILED");
    }

    const status = this.deps.sessionRepo.setStatus("active");
    this.deps.getOrchestrator().resume();
    this.deps.getOrchestrator().start();
    this.deps.eventBus.emit("session_started", {});
    this.emitSessionEvent("INFO", "Session started");
    return status;
  }

  pause(): SessionStatus {
    this.deps.getOrchestrator().pause();
    const status = this.deps.sessionRepo.setStatus("paused");
    this.emitSessionEvent("INFO", "Session paused");
    return status;
  }

  stop(reason = "User stopped session"): SessionStatus {
    this.deps.getOrchestrator().stop();
    const status = this.deps.sessionRepo.setStatus("stopped");
    this.deps.eventBus.emit("session_stopped", { reason });
    this.emitSessionEvent("INFO", reason);
    return status;
  }

  isActive(): boolean {
    return this.deps.sessionRepo.getStatus() === "active";
  }

  uptimeMin(): number {
    return this.deps.sessionRepo.uptimeMin();
  }

  getPortfolioValue(): number {
    return this.portfolioValue;
  }

  private emitSessionEvent(level: "INFO" | "WARN" | "ERROR", message: string): void {
    const event = this.deps.eventsRepo.insert({
      trade_id: null,
      level,
      agent_type: null,
      message,
    });
    this.deps.eventBus.emit("agent_event", event);
  }
}
