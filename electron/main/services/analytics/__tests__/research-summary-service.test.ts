import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { researchSummaries } from "../../../db/schema";
import { createTestDb } from "../../../db/test-helpers";
import type { ExperienceScorecard } from "../experience-scorecard-service";
import { ResearchSummaryService } from "../research-summary-service";

function makeScorecard(
  overrides: Partial<ExperienceScorecard> = {},
): ExperienceScorecard {
  return {
    experienceId: "edgar-catalyst",
    displayName: "Edgar Catalyst",
    sessionCount: 1,
    tradeCount: 10,
    winCount: 6,
    lossCount: 4,
    winRate: 0.6,
    expectancy: 18,
    maxDrawdownPct: 0.1,
    netPnlUsd: 180,
    netPnlAfterCostsUsd: 172,
    totalAiSpendUsd: 5,
    totalDataSpendUsd: 3,
    costPerTradeUsd: 0.8,
    avgHoldHours: 1,
    promotionTier: "paper",
    meetsPromotion: false,
    failedPromotionCriteria: ["minTradeCount"],
    walkForward: null,
    generatedAt: "2026-06-13T12:00:00.000Z",
    ...overrides,
  };
}

function makeService(scorecards: ExperienceScorecard[]) {
  return new ResearchSummaryService({
    generateAll: () => scorecards,
    generateForExperience: (experienceId: string) =>
      scorecards.find((scorecard) => scorecard.experienceId === experienceId) ??
      makeScorecard({ experienceId, displayName: experienceId }),
  } as never);
}

describe("ResearchSummaryService.generateSummary", () => {
  it("treats missing prior metrics as baseline deltas with positive expectancy verdict", () => {
    const service = makeService([
      makeScorecard({
        experienceId: "edgar-catalyst",
        expectancy: 12,
        winRate: 0.55,
      }),
    ]);

    const summary = service.generateSummary();

    expect(summary.deltas).toHaveLength(1);
    expect(summary.deltas[0]).toMatchObject({
      experienceId: "edgar-catalyst",
      expectancyDelta: 12,
      winRateDelta: 0.55,
      calibrationDrift: "stable",
      verdict: "improved",
    });
    expect(summary.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("marks degraded experiences when expectancy falls materially", () => {
    const service = makeService([
      makeScorecard({ expectancy: 5, winRate: 0.4 }),
    ]);

    const summary = service.generateSummary({
      "edgar-catalyst": { expectancy: 12, winRate: 0.55 },
    });

    expect(summary.deltas[0]?.expectancyDelta).toBeCloseTo(-7);
    expect(summary.deltas[0]?.winRateDelta).toBeCloseTo(-0.15);
    expect(summary.deltas[0]?.calibrationDrift).toBe("degraded");
    expect(summary.deltas[0]?.verdict).toBe("degraded");
  });

  it("marks improved experiences when expectancy and win rate both rise", () => {
    const service = makeService([
      makeScorecard({ expectancy: 20, winRate: 0.62 }),
    ]);

    const summary = service.generateSummary({
      "edgar-catalyst": { expectancy: 10, winRate: 0.5 },
    });

    expect(summary.deltas[0]).toMatchObject({
      expectancyDelta: 10,
      winRateDelta: 0.12,
      calibrationDrift: "improved",
      verdict: "improved",
    });
  });
});

describe("ResearchSummaryService persistence", () => {
  it("round-trips generated summary JSON through research_summaries", () => {
    const db = createTestDb();
    const service = makeService([
      makeScorecard({ experienceId: "edgar-catalyst" }),
      makeScorecard({
        experienceId: "rules-mean-reversion",
        displayName: "Rules Mean Reversion",
        expectancy: -2,
        winRate: 0.35,
      }),
    ]);

    const summary = service.generateSummary({
      "rules-mean-reversion": { expectancy: 4, winRate: 0.45 },
    });
    const id = randomUUID();

    db.db
      .insert(researchSummaries)
      .values({
        id,
        period: "daily",
        summaryJson: JSON.stringify(summary),
        createdAt: summary.generatedAt,
      })
      .run();

    const row = db.db
      .select()
      .from(researchSummaries)
      .where(eq(researchSummaries.id, id))
      .get();

    expect(row?.period).toBe("daily");
    expect(JSON.parse(row?.summaryJson ?? "{}")).toEqual(summary);

    db.sqlite.close();
  });
});
