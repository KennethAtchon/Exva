import { describe, expect, it, vi } from "vitest";
import { EventBus } from "../infra/event-bus";
import { NotificationService } from "../infra/notification-service";
import {
  SupervisorService,
  type SupervisorAlarmKind,
} from "./supervisor-service";
import {
  NotificationRouter,
  writeNotificationRoutingConfig,
} from "./notification-sinks";

function makeSupervisor(
  overrides: Partial<ConstructorParameters<typeof SupervisorService>[0]> = {},
) {
  const eventBus = new EventBus();
  const notifications = new NotificationService(eventBus);
  const pauseSession = vi.fn(async () => undefined);
  const supervisor = new SupervisorService({
    eventBus,
    notifications,
    pauseSession,
    ...overrides,
  });
  return { supervisor, pauseSession, notifications, eventBus };
}

describe("SupervisorService alarms", () => {
  it("raises heartbeat_stale when activity lags past 2× expected interval", async () => {
    const { supervisor } = makeSupervisor();
    supervisor.recordHeartbeat({
      sessionId: "s1",
      lastActivityAt: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
      expectedIntervalMs: 5 * 60 * 1000,
    });
    await supervisor.tick(Date.now());
    const alarms = supervisor
      .getAlarms()
      .filter((a) => a.kind === "heartbeat_stale");
    expect(alarms.length).toBeGreaterThanOrEqual(1);
    expect(alarms[0]?.sessionId).toBe("s1");
  });

  it("raises consecutive_skip via raiseConsecutiveSkip", async () => {
    const { supervisor } = makeSupervisor();
    await supervisor.raiseConsecutiveSkip("s1", "10 identical skips");
    expect(supervisor.getAlarms()[0]?.kind).toBe("consecutive_skip");
  });

  it("raises data_freshness when market lag exceeds threshold", async () => {
    const { supervisor } = makeSupervisor({
      freshnessLagMs: 60_000,
      marketData: {
        freshnessLagMs: () => 120_000,
      } as never,
    });
    supervisor.watchSymbol("BTC/USD", "15m", "s1");
    await supervisor.tick();
    expect(
      supervisor.getAlarms().some((a) => a.kind === "data_freshness"),
    ).toBe(true);
  });

  it("raises daily_loss kill switch and pauses the session", async () => {
    const { supervisor, pauseSession } = makeSupervisor({
      loadRiskSnapshots: () => [
        {
          sessionId: "s1",
          dailyPnlUsd: -250,
          drawdownFraction: 0,
          dailyLossLimitUsd: 200,
          maxDrawdownFraction: 0.5,
        },
      ],
    });
    await supervisor.tick();
    expect(supervisor.getAlarms().some((a) => a.kind === "daily_loss")).toBe(
      true,
    );
    expect(pauseSession).toHaveBeenCalledWith(
      "s1",
      expect.stringContaining("daily P&L"),
    );
  });

  it("raises drawdown kill switch and pauses the session", async () => {
    const { supervisor, pauseSession } = makeSupervisor({
      loadRiskSnapshots: () => [
        {
          sessionId: "s1",
          dailyPnlUsd: 0,
          drawdownFraction: 0.2,
          dailyLossLimitUsd: 1000,
          maxDrawdownFraction: 0.15,
        },
      ],
    });
    await supervisor.tick();
    expect(supervisor.getAlarms().some((a) => a.kind === "drawdown")).toBe(
      true,
    );
    expect(pauseSession).toHaveBeenCalled();
  });

  it("raises drift via raiseDrift", async () => {
    const { supervisor } = makeSupervisor();
    await supervisor.raiseDrift("s1", "edge decayed");
    expect(supervisor.getAlarms()[0]?.kind).toBe("drift");
  });

  it("raises ai_spend when session spend exceeds soft limit", async () => {
    const { supervisor } = makeSupervisor({ aiSpendLimitUsd: 10 });
    supervisor.recordAiSpend("s1", 12);
    await supervisor.tick();
    expect(supervisor.getAlarms().some((a) => a.kind === "ai_spend")).toBe(
      true,
    );
  });

  it("raises websocket_feed_degraded from feed health", async () => {
    const { supervisor } = makeSupervisor();
    supervisor.recordFeedHealth({
      feedId: "alpaca-orders",
      healthy: false,
      detail: "reconnect storm",
      sessionId: "s1",
    });
    await supervisor.tick();
    expect(
      supervisor.getAlarms().some((a) => a.kind === "websocket_feed_degraded"),
    ).toBe(true);
  });

  it("raises backup_failed", async () => {
    const { supervisor } = makeSupervisor();
    await supervisor.raiseBackupFailed("disk full");
    expect(supervisor.getAlarms()[0]?.kind).toBe("backup_failed");
  });

  it("triggerTestAlarm fires every kind without dedupe block", async () => {
    const { supervisor } = makeSupervisor();
    const kinds: SupervisorAlarmKind[] = [
      "heartbeat_stale",
      "consecutive_skip",
      "data_freshness",
      "daily_loss",
      "drawdown",
      "drift",
      "ai_spend",
      "websocket_feed_degraded",
      "backup_failed",
      "parity_check_failed",
    ];
    for (const kind of kinds) {
      const alarm = await supervisor.triggerTestAlarm(kind, "test");
      expect(alarm.kind).toBe(kind);
      expect(alarm.message.startsWith("TEST:")).toBe(true);
    }
    expect(supervisor.getAlarms().length).toBe(kinds.length);
  });
});

describe("NotificationRouter", () => {
  it("queues info digests and flushes at digest hour", async () => {
    writeNotificationRoutingConfig({
      digestHourLocal: 8,
      immediateSeverities: ["kill", "error"],
    });
    const pushCalls: string[] = [];
    const router = new NotificationRouter({
      ntfyTopicUrl: "https://ntfy.sh/test-exva",
      routing: { digestHourLocal: 8, ntfyEnabled: true },
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      pushCalls.push(String(input));
      return new Response("ok", { status: 200 });
    }) as typeof fetch;

    try {
      const queued = await router.deliver({
        title: "digest item",
        body: "hello",
        severity: "info",
      });
      expect(queued.immediate).toBe(false);
      expect(pushCalls).toHaveLength(0);

      const atEight = new Date();
      atEight.setHours(8, 0, 0, 0);
      const flushed = await router.maybeFlushDigest(atEight);
      expect(flushed).toBe(true);
      expect(pushCalls.length).toBeGreaterThanOrEqual(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("pushes kill severity immediately", async () => {
    const pushCalls: string[] = [];
    const router = new NotificationRouter({
      ntfyTopicUrl: "https://ntfy.sh/test-exva",
      routing: { immediateSeverities: ["kill", "error"], ntfyEnabled: true },
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      pushCalls.push(String(input));
      return new Response("ok", { status: 200 });
    }) as typeof fetch;
    try {
      const result = await router.deliver({
        title: "kill",
        body: "drawdown",
        severity: "kill",
      });
      expect(result.immediate).toBe(true);
      expect(pushCalls).toHaveLength(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
