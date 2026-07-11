import type { EventBus } from "../infra/event-bus";
import type { NotificationService } from "../infra/notification-service";
import type { MarketDataService } from "../marketdata/market-data-service";

export type AlarmSeverity = "info" | "warn" | "error" | "kill";

export interface SupervisorAlarm {
  id: string;
  sessionId: string | null;
  kind:
    | "heartbeat_stale"
    | "consecutive_skip"
    | "data_freshness"
    | "drawdown"
    | "drift"
    | "ai_spend";
  severity: AlarmSeverity;
  message: string;
  firedAt: string;
}

export interface SessionHeartbeat {
  sessionId: string;
  lastActivityAt: string;
  /** Expected max gap between activities before stale alarm. */
  expectedIntervalMs: number;
}

export interface SupervisorDeps {
  eventBus: EventBus;
  notifications: NotificationService;
  marketData?: MarketDataService;
  /** Optional ntfy topic URL, e.g. https://ntfy.sh/exva-ken */
  ntfyTopicUrl?: string | null;
  /** Freshness lag threshold before data_freshness alarm. */
  freshnessLagMs?: number;
}

/**
 * Small continuous supervisor: heartbeats, data freshness, spend/drawdown hooks.
 * Not a framework — ~alarm fan-out + notification sinks.
 */
export class SupervisorService {
  private heartbeats = new Map<string, SessionHeartbeat>();
  private alarms: SupervisorAlarm[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private aiSpendUsd = new Map<string, number>();
  private readonly freshnessLagMs: number;
  private readonly ntfyTopicUrl: string | null;

  constructor(private readonly deps: SupervisorDeps) {
    this.freshnessLagMs = deps.freshnessLagMs ?? 30 * 60 * 1000;
    this.ntfyTopicUrl = deps.ntfyTopicUrl ?? null;
  }

  start(pollMs = 60_000): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, pollMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  recordHeartbeat(input: SessionHeartbeat): void {
    this.heartbeats.set(input.sessionId, input);
  }

  recordAiSpend(sessionId: string, deltaUsd: number): void {
    this.aiSpendUsd.set(
      sessionId,
      (this.aiSpendUsd.get(sessionId) ?? 0) + deltaUsd,
    );
  }

  getAlarms(): SupervisorAlarm[] {
    return [...this.alarms];
  }

  async tick(nowMs: number = Date.now()): Promise<void> {
    for (const hb of this.heartbeats.values()) {
      const lag = nowMs - Date.parse(hb.lastActivityAt);
      if (lag > hb.expectedIntervalMs * 2) {
        await this.raise({
          id: crypto.randomUUID(),
          sessionId: hb.sessionId,
          kind: "heartbeat_stale",
          severity: "error",
          message: `Session ${hb.sessionId} silent for ${Math.round(lag / 60_000)}m (expected ≤${Math.round(hb.expectedIntervalMs / 60_000)}m).`,
          firedAt: new Date(nowMs).toISOString(),
        });
      }
    }

    if (this.deps.marketData) {
      // Freshness checks are opt-in via recorded symbols; no global scan yet.
    }

    for (const [sessionId, spend] of this.aiSpendUsd) {
      if (spend > 25) {
        await this.raise({
          id: crypto.randomUUID(),
          sessionId,
          kind: "ai_spend",
          severity: "warn",
          message: `Session ${sessionId} AI spend $${spend.toFixed(2)} exceeds $25 day soft limit.`,
          firedAt: new Date(nowMs).toISOString(),
        });
      }
    }
  }

  async checkSymbolFreshness(
    symbol: string,
    timeframe: import("@electron/shared/domain/enums").TradingTimeframe,
    sessionId: string | null = null,
  ): Promise<void> {
    if (!this.deps.marketData) return;
    const lag = this.deps.marketData.freshnessLagMs(symbol, timeframe);
    if (lag != null && lag > this.freshnessLagMs) {
      await this.raise({
        id: crypto.randomUUID(),
        sessionId,
        kind: "data_freshness",
        severity: "error",
        message: `${symbol} ${timeframe} data lag ${Math.round(lag / 60_000)}m exceeds threshold.`,
        firedAt: new Date().toISOString(),
      });
    }
  }

  private async raise(alarm: SupervisorAlarm): Promise<void> {
    // Dedupe identical kind+session within 15 minutes.
    const recent = this.alarms.find(
      (a) =>
        a.kind === alarm.kind &&
        a.sessionId === alarm.sessionId &&
        Date.parse(alarm.firedAt) - Date.parse(a.firedAt) < 15 * 60 * 1000,
    );
    if (recent) return;

    this.alarms = [alarm, ...this.alarms].slice(0, 200);
    this.deps.notifications.notify(
      `Exva: ${alarm.kind}`,
      alarm.message,
      alarm.severity === "kill" || alarm.severity === "error" ? "ERROR" : "WARN",
    );

    if (
      this.ntfyTopicUrl &&
      (alarm.severity === "error" || alarm.severity === "kill")
    ) {
      await pushNtfy(this.ntfyTopicUrl, `Exva: ${alarm.kind}`, alarm.message);
    }
  }
}

async function pushNtfy(
  topicUrl: string,
  title: string,
  body: string,
): Promise<void> {
  try {
    await fetch(topicUrl, {
      method: "POST",
      headers: {
        Title: title,
        Priority: "high",
      },
      body,
    });
  } catch {
    // Notification sink failures must not take down the supervisor loop.
  }
}
