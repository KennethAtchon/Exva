import { describe, expect, it, vi } from "vitest";
import { createTestDb } from "../../../db/test-helpers";
import { MarketCalendarRegistry } from "../market-calendar-registry";
import { ScheduleCoordinator } from "../schedule-coordinator";
import type { ScheduledRuntimePlan } from "../session-input-runtime-planner";

function makePlan(
  overrides: Partial<ScheduledRuntimePlan> = {},
): ScheduledRuntimePlan {
  return {
    groupKey: "group-1",
    templateId: "tpl",
    templateVersion: 1,
    pipelineId: "pipe",
    strategyId: "mean_reversion",
    strategyImplementationVersion: 1,
    instrumentSetId: "set-1",
    instrumentSetRevision: 1,
    cadence: { kind: "interval", every: 15, unit: "minute", jitterPct: 0.05 },
    analysisTimeframe: "1h",
    marketCalendarId: "missing-calendar",
    strategyParameters: {},
    subscriptionIds: ["sub-1"],
    ...overrides,
  };
}

describe("ScheduleCoordinator calendar misconfiguration", () => {
  it("skips the tick when the calendar is unknown (fail-closed)", async () => {
    const db = createTestDb();
    const execute = vi.fn(async () => ({ signals: [], instruments: [] }));
    const onCalendarMisconfigured = vi.fn();
    const coordinator = new ScheduleCoordinator({
      db,
      executor: { execute } as never,
      calendarRegistry: new MarketCalendarRegistry(),
      emitSignals: vi.fn(async () => undefined),
      resolveScheduledFanout: () => [],
      onCalendarMisconfigured,
    });

    coordinator.reconcile([makePlan()]);
    const telemetry = await coordinator.fireNow("group-1");

    expect(execute).not.toHaveBeenCalled();
    expect(onCalendarMisconfigured).toHaveBeenCalledOnce();
    expect(telemetry?.lastStartedAt).toBeNull();
    expect(telemetry?.lastSuccessAt).toBeNull();
  });

  it("fires when the calendar is registered and open", async () => {
    const db = createTestDb();
    const execute = vi.fn(async () => ({
      signals: [],
      instruments: [{ symbol: "SPY", kind: "no_setup" as const }],
    }));
    const registry = new MarketCalendarRegistry();
    registry.register({ id: "always-open", isOpen: () => true });
    const coordinator = new ScheduleCoordinator({
      db,
      executor: { execute } as never,
      calendarRegistry: registry,
      emitSignals: vi.fn(async () => undefined),
      resolveScheduledFanout: () => [],
    });

    coordinator.reconcile([makePlan({ marketCalendarId: "always-open" })]);
    await coordinator.fireNow("group-1");

    expect(execute).toHaveBeenCalledOnce();
  });

  it("treats all-unevaluable scans as failures, not successes", async () => {
    const db = createTestDb();
    const registry = new MarketCalendarRegistry();
    registry.register({ id: "always-open", isOpen: () => true });
    const coordinator = new ScheduleCoordinator({
      db,
      executor: {
        execute: vi.fn(async () => ({
          signals: [],
          instruments: [
            {
              symbol: "SPY",
              kind: "insufficient_bars" as const,
              barsActual: 8,
              barsRequired: 20,
            },
            {
              symbol: "QQQ",
              kind: "insufficient_bars" as const,
              barsActual: 8,
              barsRequired: 20,
            },
          ],
        })),
      } as never,
      calendarRegistry: registry,
      emitSignals: vi.fn(async () => undefined),
      resolveScheduledFanout: () => [],
    });

    coordinator.reconcile([makePlan({ marketCalendarId: "always-open" })]);
    const telemetry = await coordinator.fireNow("group-1");

    expect(telemetry?.consecutiveFailures).toBe(1);
    expect(telemetry?.lastSuccessAt).toBeNull();
    expect(telemetry?.lastError).toMatch(/All instruments unevaluable/i);
  });

  it("keeps partial-evaluable scans healthy", async () => {
    const db = createTestDb();
    const registry = new MarketCalendarRegistry();
    registry.register({ id: "always-open", isOpen: () => true });
    const coordinator = new ScheduleCoordinator({
      db,
      executor: {
        execute: vi.fn(async () => ({
          signals: [],
          instruments: [
            {
              symbol: "SPY",
              kind: "insufficient_bars" as const,
              barsActual: 8,
              barsRequired: 20,
            },
            { symbol: "QQQ", kind: "no_setup" as const },
          ],
        })),
      } as never,
      calendarRegistry: registry,
      emitSignals: vi.fn(async () => undefined),
      resolveScheduledFanout: () => [],
    });

    coordinator.reconcile([makePlan({ marketCalendarId: "always-open" })]);
    const telemetry = await coordinator.fireNow("group-1");

    expect(telemetry?.consecutiveFailures).toBe(0);
    expect(telemetry?.lastSuccessAt).toBeTruthy();
    expect(telemetry?.lastError).toBeNull();
  });
});
