import { describe, expect, it } from "vitest";
import { createTestDb } from "../../test-helpers";
import { ExperienceExperimentsRepo } from "./experience-experiments-repo";

describe("ExperienceExperimentsRepo", () => {
  it("inserts, lists, and compares experiments", () => {
    const db = createTestDb();
    const repo = new ExperienceExperimentsRepo(db);

    repo.insert({
      id: "exp-a",
      experienceId: "edgar-catalyst",
      configHash: "hash-a",
      datasetWindowStart: "2025-01-01",
      datasetWindowEnd: "2025-03-01",
      metrics: { winRate: 0.55, trades: 20 },
      notes: "Baseline",
      verdict: "promising",
    });
    repo.insert({
      id: "exp-b",
      experienceId: "edgar-catalyst",
      configHash: "hash-b",
      datasetWindowStart: "2025-01-01",
      datasetWindowEnd: "2025-03-01",
      metrics: { winRate: 0.6, trades: 22 },
      notes: "Variant",
      verdict: "inconclusive",
    });

    expect(repo.listByExperience("edgar-catalyst")).toHaveLength(2);
    expect(repo.getById("exp-a")).toMatchObject({
      verdict: "promising",
      metrics: { winRate: 0.55 },
    });

    const comparison = repo.compare("exp-a", "exp-b");
    expect(comparison?.metricDiffs.winRate).toMatchObject({
      a: 0.55,
      b: 0.6,
    });
    expect(comparison?.metricDiffs.winRate.delta).toBeCloseTo(0.05, 6);

    db.sqlite.close();
  });
});
