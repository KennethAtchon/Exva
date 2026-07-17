import type { EventBus } from "../infra/event-bus";
import type { NotificationService } from "../infra/notification-service";
import { createLogger } from "../infra/log";
import type { MarketDataService } from "../marketdata/market-data-service";
import type { TradingTimeframe } from "@electron/shared/domain/enums";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  runNightlyResearchJobs,
  type NightlyResearchJobDeps,
} from "../research/nightly-jobs";
import {
  NotificationRouter,
  type NotificationRouteSeverity,
  type NotificationRoutingConfig,
  type TelegramCredentials,
} from "./notification-sinks";

const supervisorLogger = createLogger("supervisor");
const NIGHTLY_LOCAL_HOUR = 8;
const LAST_NIGHTLY_PATH = path.join(os.homedir(), ".exva", "last-nightly-run");

export type AlarmSeverity = "info" | "warn" | "error" | "kill";

export type SupervisorAlarmKind =
  | "heartbeat_stale"
  | "consecutive_skip"
  | "data_freshness"
  | "daily_loss"
  | "drawdown"
  | "drift"
  | "ai_spend"
  | "websocket_feed_degraded"
  | "backup_failed"
  | "parity_check_failed";

export interface SupervisorAlarm {
  id: string;
  sessionId: string | null;
  kind: SupervisorAlarmKind;
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

export interface WatchedSymbol {
  symbol: string;
  timeframe: TradingTimeframe;
  sessionId: string | null;
}

export interface SessionRiskSnapshot {
  sessionId: string;
  /** Realized + unrealized P&L for the local day (USD). */
  dailyPnlUsd: number;
  /** Peak-to-trough drawdown fraction (0.03 = 3%). */
  drawdownFraction: number;
  dailyLossLimitUsd: number;
  maxDrawdownFraction: number;
}

export interface SupervisorDeps {
  eventBus: EventBus;
  notifications: NotificationService;
  marketData?: MarketDataService;
  /** Optional ntfy topic URL, e.g. https://ntfy.sh/exva-ken */
  ntfyTopicUrl?: string | null;
  /** Optional http(s) webhook that relays supervisor digests (email bridge). */
  smtpUrl?: string | null;
  resolveTelegram?: () => TelegramCredentials | null;
  /** Freshness lag threshold before data_freshness alarm. */
  freshnessLagMs?: number;
  /** Soft AI spend limit (USD) per session before ai_spend warn. */
  aiSpendLimitUsd?: number;
  /** Optional nightly research job hooks (calibration, labels, autopsy). */
  nightlyResearch?: NightlyResearchJobDeps;
  /** Auto-pause session when kill switch trips. */
  pauseSession?: (sessionId: string, reason: string) => Promise<void> | void;
  /** Load per-session daily P&L / drawdown for kill-switch checks. */
  loadRiskSnapshots?: () => SessionRiskSnapshot[];
  /** Load per-session AI spend (USD) for runaway alarm. */
  loadAiSpendBySession?: () => Array<{ sessionId: string; spendUsd: number }>;
}

/**
 * Continuous supervisor: heartbeats, freshness, spend/drawdown, feed + backup.
 * Alarm fan-out + notification sinks (in-app, ntfy, Telegram, digest).
 */
export class SupervisorService {
  private heartbeats = new Map<string, SessionHeartbeat>();
  private watchedSymbols = new Map<string, WatchedSymbol>();
  private riskSnapshots = new Map<string, SessionRiskSnapshot>();
  private feedHealth = new Map<
    string,
    { healthy: boolean; detail: string; sessionId: string | null }
  >();
  private alarms: SupervisorAlarm[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private aiSpendUsd = new Map<string, number>();
  private readonly freshnessLagMs: number;
  private readonly aiSpendLimitUsd: number;
  private lastNightlyRunMs = 0;
  readonly router: NotificationRouter;

  constructor(private readonly deps: SupervisorDeps) {
    this.freshnessLagMs = deps.freshnessLagMs ?? 30 * 60 * 1000;
    this.aiSpendLimitUsd = deps.aiSpendLimitUsd ?? 25;
    this.router = new NotificationRouter({
      ntfyTopicUrl: deps.ntfyTopicUrl ?? null,
      smtpUrl: deps.smtpUrl ?? null,
      resolveTelegram: deps.resolveTelegram,
    });
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

  /** Track a symbol for continuous data-freshness checks in tick(). */
  watchSymbol(
    symbol: string,
    timeframe: TradingTimeframe,
    sessionId: string | null = null,
  ): void {
    const key = `${symbol}|${timeframe}|${sessionId ?? ""}`;
    this.watchedSymbols.set(key, { symbol, timeframe, sessionId });
  }

  recordRiskSnapshot(snapshot: SessionRiskSnapshot): void {
    this.riskSnapshots.set(snapshot.sessionId, snapshot);
  }

  /** Report websocket / order-feed health (false → websocket_feed_degraded). */
  recordFeedHealth(input: {
    feedId: string;
    healthy: boolean;
    detail: string;
    sessionId?: string | null;
  }): void {
    this.feedHealth.set(input.feedId, {
      healthy: input.healthy,
      detail: input.detail,
      sessionId: input.sessionId ?? null,
    });
  }

  getAlarms(): SupervisorAlarm[] {
    return [...this.alarms];
  }

  getRouting(): NotificationRoutingConfig {
    return this.router.getRouting();
  }

  setRouting(
    patch: Partial<NotificationRoutingConfig>,
  ): NotificationRoutingConfig {
    return this.router.setRouting(patch);
  }

  async raiseConsecutiveSkip(
    sessionId: string,
    message: string,
  ): Promise<void> {
    await this.raise({
      id: crypto.randomUUID(),
      sessionId,
      kind: "consecutive_skip",
      severity: "error",
      message,
      firedAt: new Date().toISOString(),
    });
  }

  async raiseDrawdown(sessionId: string, message: string): Promise<void> {
    await this.raise({
      id: crypto.randomUUID(),
      sessionId,
      kind: "drawdown",
      severity: "kill",
      message,
      firedAt: new Date().toISOString(),
    });
  }

  async raiseDailyLoss(sessionId: string, message: string): Promise<void> {
    await this.raise({
      id: crypto.randomUUID(),
      sessionId,
      kind: "daily_loss",
      severity: "kill",
      message,
      firedAt: new Date().toISOString(),
    });
  }

  async raiseDrift(sessionId: string, message: string): Promise<void> {
    await this.raise({
      id: crypto.randomUUID(),
      sessionId,
      kind: "drift",
      severity: "error",
      message,
      firedAt: new Date().toISOString(),
    });
  }

  async raiseBackupFailed(message: string): Promise<void> {
    await this.raise({
      id: crypto.randomUUID(),
      sessionId: null,
      kind: "backup_failed",
      severity: "error",
      message,
      firedAt: new Date().toISOString(),
    });
  }

  async raiseDataFreshness(
    symbol: string | null,
    message: string,
  ): Promise<void> {
    await this.raise({
      id: crypto.randomUUID(),
      sessionId: null,
      kind: "data_freshness",
      severity: "warn",
      message: symbol ? `${symbol}: ${message}` : message,
      firedAt: new Date().toISOString(),
    });
  }

  async raiseWebsocketFeedDegraded(
    sessionId: string | null,
    message: string,
  ): Promise<void> {
    await this.raise({
      id: crypto.randomUUID(),
      sessionId,
      kind: "websocket_feed_degraded",
      severity: "error",
      message,
      firedAt: new Date().toISOString(),
    });
  }

  async raiseParityCheckFailed(
    sessionId: string | null,
    message: string,
  ): Promise<void> {
    await this.raise({
      id: crypto.randomUUID(),
      sessionId,
      kind: "parity_check_failed",
      severity: "warn",
      message,
      firedAt: new Date().toISOString(),
    });
  }

  /** Dev Panel / Settings: fire a synthetic alarm of the given kind. */
  async triggerTestAlarm(
    kind: SupervisorAlarmKind,
    sessionId: string | null = "test-session",
  ): Promise<SupervisorAlarm> {
    const messages: Record<SupervisorAlarmKind, string> = {
      heartbeat_stale: `TEST: session ${sessionId} heartbeat stale`,
      consecutive_skip: `TEST: session ${sessionId} consecutive identical skips`,
      data_freshness: `TEST: data freshness lag exceeded`,
      daily_loss: `TEST: session ${sessionId} daily loss kill switch`,
      drawdown: `TEST: session ${sessionId} max drawdown kill switch`,
      drift: `TEST: session ${sessionId} edge drift`,
      ai_spend: `TEST: session ${sessionId} AI spend runaway`,
      websocket_feed_degraded: `TEST: websocket feed degraded`,
      backup_failed: `TEST: database backup failed`,
      parity_check_failed: `TEST: ghost fill parity check failed`,
    };
    const severity: AlarmSeverity =
      kind === "daily_loss" || kind === "drawdown"
        ? "kill"
        : kind === "ai_spend"
          ? "warn"
          : "error";
    const alarm: SupervisorAlarm = {
      id: crypto.randomUUID(),
      sessionId,
      kind,
      severity,
      message: messages[kind],
      firedAt: new Date().toISOString(),
    };
    await this.raise(alarm, { skipDedupe: true });
    return alarm;
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

    for (const watched of this.watchedSymbols.values()) {
      await this.checkSymbolFreshness(
        watched.symbol,
        watched.timeframe,
        watched.sessionId,
      );
    }

    if (this.deps.loadRiskSnapshots) {
      try {
        for (const snap of this.deps.loadRiskSnapshots()) {
          this.riskSnapshots.set(snap.sessionId, snap);
        }
      } catch (err) {
        // Risk snapshot failures must not take down the supervisor loop.
        supervisorLogger.warn({ err }, "loadRiskSnapshots failed");
      }
    }

    for (const snap of this.riskSnapshots.values()) {
      await this.evaluateRiskKillSwitches(snap);
    }

    for (const [feedId, health] of this.feedHealth) {
      if (!health.healthy) {
        await this.raiseWebsocketFeedDegraded(
          health.sessionId,
          `Feed ${feedId} degraded: ${health.detail}`,
        );
      }
    }

    if (this.deps.loadAiSpendBySession) {
      try {
        for (const row of this.deps.loadAiSpendBySession()) {
          this.aiSpendUsd.set(row.sessionId, row.spendUsd);
        }
      } catch (err) {
        // Spend load failures must not take down the supervisor loop.
        supervisorLogger.warn({ err }, "loadAiSpendBySession failed");
      }
    }

    for (const [sessionId, spend] of this.aiSpendUsd) {
      if (spend > this.aiSpendLimitUsd) {
        await this.raise({
          id: crypto.randomUUID(),
          sessionId,
          kind: "ai_spend",
          severity: "warn",
          message: `Session ${sessionId} AI spend $${spend.toFixed(2)} exceeds $${this.aiSpendLimitUsd} day soft limit.`,
          firedAt: new Date(nowMs).toISOString(),
        });
      }
    }

    await this.router.maybeFlushDigest(new Date(nowMs));

    if (this.deps.nightlyResearch && shouldRunNightly(nowMs)) {
      this.lastNightlyRunMs = nowMs;
      persistNightlyRunDate(localDateKey(nowMs));
      try {
        await runNightlyResearchJobs(this.deps.nightlyResearch);
      } catch (err) {
        // Nightly research failures must not take down the supervisor loop.
        supervisorLogger.error({ err }, "nightly research jobs failed");
      }
    }
  }

  async checkSymbolFreshness(
    symbol: string,
    timeframe: TradingTimeframe,
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

  private async evaluateRiskKillSwitches(
    snap: SessionRiskSnapshot,
  ): Promise<void> {
    if (
      snap.dailyLossLimitUsd > 0 &&
      snap.dailyPnlUsd <= -Math.abs(snap.dailyLossLimitUsd)
    ) {
      await this.raiseDailyLoss(
        snap.sessionId,
        `Session ${snap.sessionId} daily P&L $${snap.dailyPnlUsd.toFixed(2)} hit loss limit −$${snap.dailyLossLimitUsd.toFixed(2)}.`,
      );
    }
    if (
      snap.maxDrawdownFraction > 0 &&
      snap.drawdownFraction >= snap.maxDrawdownFraction
    ) {
      await this.raiseDrawdown(
        snap.sessionId,
        `Session ${snap.sessionId} drawdown ${(snap.drawdownFraction * 100).toFixed(1)}% ≥ limit ${(snap.maxDrawdownFraction * 100).toFixed(1)}%.`,
      );
    }
  }

  private async raise(
    alarm: SupervisorAlarm,
    options?: { skipDedupe?: boolean },
  ): Promise<void> {
    if (!options?.skipDedupe) {
      const recent = this.alarms.find(
        (a) =>
          a.kind === alarm.kind &&
          a.sessionId === alarm.sessionId &&
          Date.parse(alarm.firedAt) - Date.parse(a.firedAt) < 15 * 60 * 1000,
      );
      if (recent) return;
    }

    this.alarms = [alarm, ...this.alarms].slice(0, 200);
    const level =
      alarm.severity === "kill" || alarm.severity === "error"
        ? "ERROR"
        : alarm.severity === "warn"
          ? "WARN"
          : "INFO";
    this.deps.notifications.notify(`Exva: ${alarm.kind}`, alarm.message, level);

    const routeSeverity = alarmSeverityToRoute(alarm.severity);
    await this.router.deliver({
      title: `Exva: ${alarm.kind}`,
      body: alarm.message,
      severity: routeSeverity,
    });

    if (
      (alarm.severity === "kill" ||
        alarm.kind === "daily_loss" ||
        alarm.kind === "drawdown") &&
      alarm.sessionId &&
      this.deps.pauseSession
    ) {
      try {
        await this.deps.pauseSession(alarm.sessionId, alarm.message);
      } catch (err) {
        // Pause failures must not take down the supervisor loop.
        supervisorLogger.error(
          { err, sessionId: alarm.sessionId, kind: alarm.kind },
          "auto-pause after kill switch failed",
        );
      }
    }
  }
}

function alarmSeverityToRoute(
  severity: AlarmSeverity,
): NotificationRouteSeverity {
  if (severity === "kill") return "kill";
  if (severity === "error") return "error";
  if (severity === "warn") return "warn";
  return "info";
}

function localDateKey(nowMs: number): string {
  const d = new Date(nowMs);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function readPersistedNightlyDate(
  filePath: string = LAST_NIGHTLY_PATH,
): string | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath, "utf8").trim() || null;
  } catch {
    return null;
  }
}

function persistNightlyRunDate(
  dateKey: string,
  filePath: string = LAST_NIGHTLY_PATH,
): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${dateKey}\n`);
}

/** Fire once per local calendar day at/after 08:00 local. */
export function shouldRunNightly(
  nowMs: number,
  filePath: string = LAST_NIGHTLY_PATH,
): boolean {
  const now = new Date(nowMs);
  if (now.getHours() < NIGHTLY_LOCAL_HOUR) return false;
  const today = localDateKey(nowMs);
  return readPersistedNightlyDate(filePath) !== today;
}
