import type { SessionRepo } from "../../db/repositories/sessions/session-repo";
import type { EventsRepo } from "../../db/repositories/system/events-repo";
import { requireExperience } from "../../experiences/index";
import type { Logger } from "../infra/log";
import type { ResearchExperimentService } from "./research-experiment-service";
import type { SupervisorService } from "../supervisor/supervisor-service";

/**
 * Periodically checks live/active experiences for edge drift (P7). When recent
 * realized calibration or risk-adjusted return deviates from the validation
 * distribution, it raises a WARN event + supervisor drift alarm so the
 * operator can intervene — a decayed edge is worse than no edge.
 *
 * Conservative by design: it surfaces drift rather than silently killing a
 * session, leaving the stop decision to the operator / live policy.
 */
export class DriftMonitorTicker {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    private readonly researchExperiment: ResearchExperimentService,
    private readonly sessionRepo: SessionRepo,
    private readonly eventsRepo: EventsRepo,
    private readonly logger: Logger,
    private readonly recentWindow = 30,
    private readonly tickIntervalMs = 30 * 60 * 1000,
    private readonly supervisor?: SupervisorService,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, this.tickIntervalMs);
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const sessions = this.sessionRepo.listByStatuses([
        "active",
        "monitoring_only",
      ]);
      const seen = new Set<string>();
      for (const session of sessions) {
        const experienceId = session.experienceId;
        if (!experienceId || seen.has(experienceId)) continue;
        seen.add(experienceId);

        const contract = safeContract(experienceId);
        if (!contract) continue;

        const drift = this.researchExperiment.checkDrift({
          experienceId,
          contract,
          recentWindow: this.recentWindow,
        });
        if (!drift.shouldKill) continue;

        const message =
          `Edge drift detected for experience '${experienceId}': ${drift.reasons.join(", ")}. ` +
          `Recent Sharpe lower bound ${drift.recentSharpeLower.toFixed(2)}` +
          (drift.recentBrier != null
            ? `, recent Brier ${drift.recentBrier.toFixed(3)}`
            : "") +
          ". Consider pausing or shrinking this strategy.";
        this.logger.warn({ experienceId, drift }, "edge drift detected");
        this.eventsRepo.insert({
          session_id: session.id,
          trade_id: null,
          level: "WARN",
          agent_type: "period_autopsy",
          message,
        });
        await this.supervisor?.raiseDrift(session.id, message);
      }
    } catch (err) {
      this.logger.warn({ err }, "drift monitor tick failed");
    } finally {
      this.running = false;
    }
  }
}

function safeContract(experienceId: string) {
  try {
    return requireExperience(experienceId).researchContract;
  } catch {
    return null;
  }
}
