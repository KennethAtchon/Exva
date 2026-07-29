import { z } from "zod";
import { describe, expect, it, vi } from "vitest";
import { createTestDb } from "../../../db/test-helpers";
import {
  instrumentSetMembers,
  instrumentSetRevisions,
  instrumentSets,
} from "../../../db/schema";
import { StrategyDefinitionRegistry } from "../../strategies/strategy-definition-registry";
import { ScheduledStrategyExecutor } from "../scheduled-strategy-executor";
import type { ScheduledRuntimePlan } from "../session-input-runtime-planner";

describe("ScheduledStrategyExecutor history provisioning", () => {
  it("provisions the exact lane before fetching its bars", async () => {
    const db = createTestDb();
    const now = new Date().toISOString();
    db.db
      .insert(instrumentSets)
      .values({ id: "set-1", createdAt: now, updatedAt: now })
      .run();
    db.db
      .insert(instrumentSetRevisions)
      .values({
        setId: "set-1",
        revision: 1,
        status: "active",
        name: "Stocks",
        instrumentClass: "stock",
        mode: "static",
        createdAt: now,
      })
      .run();
    db.db
      .insert(instrumentSetMembers)
      .values({
        setId: "set-1",
        setRevision: 1,
        canonicalId: "QQQ",
        displaySymbol: "QQQ",
      })
      .run();

    const strategyRegistry = new StrategyDefinitionRegistry();
    strategyRegistry.register({
      id: "test-strategy",
      parameterSchemaVersion: 1,
      parameterSchema: z.object({}),
      acceptedInstrumentClasses: ["stock"],
      supportedTimeframes: ["1h"],
      minimumCadenceMs: 60_000,
      requiredBarCount: 50,
      implementationStatus: "available",
      implementationVersion: 1,
      create: () => ({
        id: "test-strategy",
        warmupBars: 21,
        evaluate: () => null,
      }),
    });
    const order: string[] = [];
    const provisionHistory = vi.fn(async () => {
      order.push("provision");
    });
    const getBars = vi.fn(async () => {
      order.push("fetch");
      return Array.from({ length: 250 }, (_, index) => ({
        ts: new Date(Date.UTC(2026, 0, 1, index)).toISOString(),
        open: 1,
        high: 2,
        low: 0.5,
        close: 1.5,
        volume: 100,
      }));
    });
    const executor = new ScheduledStrategyExecutor({
      db,
      strategyRegistry,
      provisionHistory,
      getBars,
    });
    const plan = {
      groupKey: "group-1",
      strategyId: "test-strategy",
      strategyParameters: {},
      strategyImplementationVersion: 1,
      instrumentSetId: "set-1",
      instrumentSetRevision: 1,
      analysisTimeframe: "1h",
      subscriptionIds: ["subscription-1"],
    } as ScheduledRuntimePlan;

    await executor.execute(plan);

    expect(provisionHistory).toHaveBeenCalledWith(
      "QQQ",
      "1h",
      "stock",
      {
        minEvaluableBars: 50,
        preferredContextBars: 250,
        warmupBars: 21,
        strategyImplementationVersion: 1,
        strategyParameters: {},
      },
      { subscriptionIds: ["subscription-1"] },
    );
    expect(order).toEqual(["provision", "fetch"]);
  });
});
