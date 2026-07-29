import { describe, expect, it, vi } from "vitest";
import { ScheduledHistoryProvisioningService } from "../scheduled-history-provisioning-service";

describe("ScheduledHistoryProvisioningService", () => {
  it("provisions every scheduled lane from its runtime plan", async () => {
    const ensure = vi.fn(async (input) => ({
      kind: "satisfied" as const,
      storedBars: input.contract.preferredContextBars,
      oldestTs: "2026-01-01T00:00:00.000Z",
      newestTs: "2026-07-29T00:00:00.000Z",
    }));
    const resolveBrokerAccountId = vi.fn(() => "futures-broker");
    const service = new ScheduledHistoryProvisioningService({
      subscriptions: {
        listEnabledBySession: () => [
          { id: "scheduled-for-session", mode: "scheduled_scan" },
          { id: "event-for-session", mode: "event_source" },
        ],
      },
      planner: {
        buildPlans: () => [
          {
            subscriptionIds: ["scheduled-for-session"],
            strategyId: "wide-strategy",
            strategyParameters: { lookback: 60 },
            instrumentSetId: "energy-futures",
            instrumentSetRevision: 3,
            analysisTimeframe: "4h",
          },
          {
            subscriptionIds: ["another-session"],
            strategyId: "wide-strategy",
            strategyParameters: {},
            instrumentSetId: "unrelated",
            instrumentSetRevision: 1,
            analysisTimeframe: "15m",
          },
        ],
      },
      instrumentSets: {
        getRevision: (setId: string) =>
          setId === "energy-futures"
            ? {
                instrumentClass: "futures",
                members: [{ displaySymbol: "GC" }, { displaySymbol: "CL" }],
              }
            : null,
      },
      strategies: {
        require: () => ({
          requiredBarCount: 64,
          create: () => ({ warmupBars: 61 }),
        }),
      },
      brokerRouting: { resolveBrokerAccountId },
      history: { ensure },
    } as never);

    await service.ensureSession("session-1");

    expect(resolveBrokerAccountId).toHaveBeenCalledWith("session-1", "futures");
    expect(ensure).toHaveBeenCalledTimes(2);
    for (const symbol of ["GC", "CL"]) {
      expect(ensure).toHaveBeenCalledWith({
        symbol,
        instrumentClass: "futures",
        timeframe: "4h",
        brokerAccountId: "futures-broker",
        contract: {
          minEvaluableBars: 64,
          preferredContextBars: 256,
          warmupBars: 61,
        },
      });
    }
  });

  it("blocks activation when automatic provisioning cannot reach the minimum", async () => {
    const service = new ScheduledHistoryProvisioningService({
      subscriptions: {
        listEnabledBySession: () => [
          { id: "scheduled-for-session", mode: "scheduled_scan" },
        ],
      },
      planner: {
        buildPlans: () => [
          {
            subscriptionIds: ["scheduled-for-session"],
            strategyId: "strategy",
            strategyParameters: {},
            instrumentSetId: "stocks",
            instrumentSetRevision: 1,
            analysisTimeframe: "1h",
          },
        ],
      },
      instrumentSets: {
        getRevision: () => ({
          instrumentClass: "stock",
          members: [{ displaySymbol: "QQQ" }],
        }),
      },
      strategies: {
        require: () => ({
          requiredBarCount: 50,
          create: () => ({ warmupBars: 21 }),
        }),
      },
      brokerRouting: { resolveBrokerAccountId: () => "alpaca" },
      history: {
        ensure: async () => ({
          kind: "partial" as const,
          storedBars: 21,
          minEvaluableBars: 50,
          reason: "insufficient_after_backfill",
        }),
      },
    } as never);

    await expect(service.ensureSession("session-1")).rejects.toThrow(
      "Scheduled history unavailable for QQQ 1h: insufficient_after_backfill",
    );
  });
});
