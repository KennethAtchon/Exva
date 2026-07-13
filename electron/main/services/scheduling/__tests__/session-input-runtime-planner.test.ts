import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { createTestDb } from "../../../db/test-helpers";
import {
  experienceTemplates,
  experienceTemplateRevisions,
  instrumentSets,
  instrumentSetRevisions,
  sessions,
  sessionInputSubscriptions,
} from "../../../db/schema";
import { SessionInputRuntimePlanner } from "../session-input-runtime-planner";
import { StrategyDefinitionRegistry } from "../../strategies/strategy-definition-registry";
import type { StrategyDefinition } from "../../strategies/strategy-definition-registry";
import { serializeCadenceCanonical } from "@electron/shared/domain/experience-inputs/cadence";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStrategyDef(
  id: string,
  implementationVersion = 1,
): StrategyDefinition<Record<string, unknown>> {
  return {
    id,
    parameterSchemaVersion: 1,
    parameterSchema: z.object({}).passthrough(),
    acceptedInstrumentClasses: ["stock"],
    supportedTimeframes: ["1h"],
    minimumCadenceMs: 60_000,
    requiredBarCount: 20,
    implementationStatus: "available",
    implementationVersion,
    create: () => ({
      id,
      warmupBars: 20,
      evaluate: () => null,
    }),
  };
}

function setupFixtures(
  db: ReturnType<typeof createTestDb>,
  overrides?: {
    strategyId?: string | null;
    strategyId2?: string;
    cadence2?: string;
    analysisTimeframe2?: string;
  },
) {
  const now = new Date().toISOString();
  // Use explicit "in" check so that strategyId: null is preserved as null.
  const strategyId =
    overrides !== undefined && "strategyId" in overrides
      ? overrides.strategyId
      : "mean-reversion";

  // Template
  db.db
    .insert(experienceTemplates)
    .values({ id: "tmpl-1", createdAt: now, updatedAt: now })
    .run();
  db.db
    .insert(experienceTemplateRevisions)
    .values({
      templateId: "tmpl-1",
      version: 1,
      status: "active",
      displayName: "Test Template",
      description: "Test",
      pipelineId: "pipe-a",
      strategyId,
      promptVariantKey: "default",
      brokerRequirement: "any",
      inputContractJson: "{}",
      defaultPresetIdsJson: "{}",
      researchContractJson: "{}",
      universePolicy: "validated_only",
      createdAt: now,
    })
    .run();

  // Instrument set
  db.db
    .insert(instrumentSets)
    .values({ id: "set-x", createdAt: now, updatedAt: now })
    .run();
  db.db
    .insert(instrumentSetRevisions)
    .values({
      setId: "set-x",
      revision: 1,
      status: "active",
      name: "Test Set",
      instrumentClass: "stock",
      mode: "static",
      createdAt: now,
    })
    .run();

  // Session
  db.db
    .insert(sessions)
    .values({
      id: "sess-1",
      name: "Test",
      objective: "Test",
      status: "active",
      instrumentClasses: "stock",
      instrumentScope: "AAPL",
      executionMode: "paper_only",
      experienceId: "edgar-catalyst",
      createdAt: now,
      updatedAt: now,
    })
    .run();
  db.db
    .insert(sessions)
    .values({
      id: "sess-2",
      name: "Test2",
      objective: "Test2",
      status: "active",
      instrumentClasses: "stock",
      instrumentScope: "MSFT",
      executionMode: "paper_only",
      experienceId: "edgar-catalyst",
      createdAt: now,
      updatedAt: now,
    })
    .run();

  const cadenceJson = serializeCadenceCanonical({
    kind: "interval",
    every: 15,
    unit: "minute",
    jitterPct: 0.05,
  });

  const cadenceJson2 = overrides?.cadence2
    ? serializeCadenceCanonical({
        kind: "interval",
        every: parseInt(overrides.cadence2),
        unit: "minute",
        jitterPct: 0.05,
      })
    : cadenceJson;

  const analysisTimeframe2 = overrides?.analysisTimeframe2 ?? "1h";

  // Subscription 1
  db.db
    .insert(sessionInputSubscriptions)
    .values({
      id: "sub-1",
      sessionId: "sess-1",
      templateId: "tmpl-1",
      templateVersion: 1,
      mode: "scheduled_scan",
      enabled: true,
      revision: 1,
      instrumentSetId: "set-x",
      instrumentSetRevision: 1,
      cadenceJson,
      analysisTimeframe: "1h",
      marketCalendarId: "nyse-regular",
      strategyParametersJson: JSON.stringify({ zScoreEntry: -2 }),
      createdAt: now,
      updatedAt: now,
    })
    .run();

  // Subscription 2 (different session, same parameters → should coalesce with sub-1)
  db.db
    .insert(sessionInputSubscriptions)
    .values({
      id: "sub-2",
      sessionId: "sess-2",
      templateId: "tmpl-1",
      templateVersion: 1,
      mode: "scheduled_scan",
      enabled: true,
      revision: 1,
      instrumentSetId: "set-x",
      instrumentSetRevision: 1,
      cadenceJson: cadenceJson2,
      analysisTimeframe: analysisTimeframe2,
      marketCalendarId: "nyse-regular",
      strategyParametersJson: JSON.stringify({
        zScoreEntry: -2,
        ...(overrides?.strategyId2 ? {} : {}),
      }),
      createdAt: now,
      updatedAt: now,
    })
    .run();

  return { cadenceJson };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SessionInputRuntimePlanner", () => {
  it("returns an empty array when no scheduled subscriptions exist", () => {
    const db = createTestDb();
    const registry = new StrategyDefinitionRegistry();
    registry.register(makeStrategyDef("mean-reversion"));
    const planner = new SessionInputRuntimePlanner({
      db,
      strategyRegistry: registry,
    });
    expect(planner.buildPlans()).toHaveLength(0);
  });

  it("builds one plan for a single enabled subscription", () => {
    const db = createTestDb();
    const registry = new StrategyDefinitionRegistry();
    registry.register(makeStrategyDef("mean-reversion"));
    setupFixtures(db);
    const planner = new SessionInputRuntimePlanner({
      db,
      strategyRegistry: registry,
    });
    const plans = planner.buildPlans();
    expect(plans).toHaveLength(1);
    const plan = plans[0];
    expect(plan.strategyId).toBe("mean-reversion");
    expect(plan.pipelineId).toBe("pipe-a");
    expect(plan.instrumentSetId).toBe("set-x");
    expect(plan.cadence.kind).toBe("interval");
    expect(plan.subscriptionIds).toContain("sub-1");
  });

  it("coalesces two subscriptions with identical parameters into one plan", () => {
    const db = createTestDb();
    const registry = new StrategyDefinitionRegistry();
    registry.register(makeStrategyDef("mean-reversion"));
    // sub-1 and sub-2 both use identical cadence / analysisTimeframe / params
    setupFixtures(db);
    const planner = new SessionInputRuntimePlanner({
      db,
      strategyRegistry: registry,
    });
    const plans = planner.buildPlans();
    // Both subscriptions should collapse to 1 group
    expect(plans).toHaveLength(1);
    expect(plans[0].subscriptionIds).toHaveLength(2);
    expect(plans[0].subscriptionIds).toContain("sub-1");
    expect(plans[0].subscriptionIds).toContain("sub-2");
  });

  it("produces two plans when analysisTimeframes differ", () => {
    const db = createTestDb();
    const registry = new StrategyDefinitionRegistry();
    registry.register(makeStrategyDef("mean-reversion"));
    setupFixtures(db, { analysisTimeframe2: "4h" }); // sub-2 uses 4h instead of 1h
    const planner = new SessionInputRuntimePlanner({
      db,
      strategyRegistry: registry,
    });
    const plans = planner.buildPlans();
    expect(plans).toHaveLength(2);
  });

  it("produces two plans when cadences differ", () => {
    const db = createTestDb();
    const registry = new StrategyDefinitionRegistry();
    registry.register(makeStrategyDef("mean-reversion"));
    setupFixtures(db, { cadence2: "30" }); // sub-2 uses 30m
    const planner = new SessionInputRuntimePlanner({
      db,
      strategyRegistry: registry,
    });
    const plans = planner.buildPlans();
    expect(plans).toHaveLength(2);
  });

  it("skips disabled subscriptions", () => {
    const db = createTestDb();
    const registry = new StrategyDefinitionRegistry();
    registry.register(makeStrategyDef("mean-reversion"));
    setupFixtures(db);
    // Disable sub-2
    db.db
      .update(sessionInputSubscriptions)
      .set({ enabled: false })
      .where(eq(sessionInputSubscriptions.id, "sub-2"))
      .run();
    const planner = new SessionInputRuntimePlanner({
      db,
      strategyRegistry: registry,
    });
    const plans = planner.buildPlans();
    expect(plans).toHaveLength(1);
    expect(plans[0].subscriptionIds).toHaveLength(1);
    expect(plans[0].subscriptionIds[0]).toBe("sub-1");
  });

  it("skips subscriptions whose template revision is not found", () => {
    const db = createTestDb();
    const registry = new StrategyDefinitionRegistry();
    registry.register(makeStrategyDef("mean-reversion"));
    const now = new Date().toISOString();
    // Insert session without template
    db.db
      .insert(sessions)
      .values({
        id: "sess-orphan",
        name: "Orphan",
        objective: "",
        status: "active",
        instrumentClasses: "stock",
        instrumentScope: "SPY",
        executionMode: "paper_only",
        experienceId: "edgar-catalyst",
        createdAt: now,
        updatedAt: now,
      })
      .run();
    db.db
      .insert(sessionInputSubscriptions)
      .values({
        id: "sub-orphan",
        sessionId: "sess-orphan",
        templateId: "nonexistent-tmpl",
        templateVersion: 99,
        mode: "scheduled_scan",
        enabled: true,
        revision: 1,
        instrumentSetId: "set-x",
        instrumentSetRevision: 1,
        cadenceJson: JSON.stringify({
          kind: "interval",
          every: 15,
          unit: "minute",
          jitterPct: 0.05,
        }),
        analysisTimeframe: "1h",
        marketCalendarId: "nyse-regular",
        strategyParametersJson: "{}",
        createdAt: now,
        updatedAt: now,
      })
      .run();
    const planner = new SessionInputRuntimePlanner({
      db,
      strategyRegistry: registry,
    });
    // Should not throw; orphan is silently skipped
    expect(() => planner.buildPlans()).not.toThrow();
  });

  it("skips subscriptions whose strategy is not in the registry", () => {
    const db = createTestDb();
    const registry = new StrategyDefinitionRegistry();
    // Intentionally do NOT register "mean-reversion"
    setupFixtures(db);
    const planner = new SessionInputRuntimePlanner({
      db,
      strategyRegistry: registry,
    });
    expect(planner.buildPlans()).toHaveLength(0);
  });

  it("skips subscriptions with a disabled strategy", () => {
    const db = createTestDb();
    const registry = new StrategyDefinitionRegistry();
    const disabledDef = {
      ...makeStrategyDef("mean-reversion"),
      implementationStatus: "disabled" as const,
    };
    registry.register(disabledDef);
    setupFixtures(db);
    const planner = new SessionInputRuntimePlanner({
      db,
      strategyRegistry: registry,
    });
    expect(planner.buildPlans()).toHaveLength(0);
  });

  it("skips subscriptions when template has no strategyId", () => {
    const db = createTestDb();
    const registry = new StrategyDefinitionRegistry();
    registry.register(makeStrategyDef("mean-reversion"));
    setupFixtures(db, { strategyId: null });
    const planner = new SessionInputRuntimePlanner({
      db,
      strategyRegistry: registry,
    });
    expect(planner.buildPlans()).toHaveLength(0);
  });

  it("strategyImplementationVersion is taken from the registry", () => {
    const db = createTestDb();
    const registry = new StrategyDefinitionRegistry();
    registry.register(makeStrategyDef("mean-reversion", 7));
    setupFixtures(db);
    const planner = new SessionInputRuntimePlanner({
      db,
      strategyRegistry: registry,
    });
    const plans = planner.buildPlans();
    expect(plans[0].strategyImplementationVersion).toBe(7);
  });
});
