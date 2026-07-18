import type { DbClient } from "../../client";
import { desc, eq } from "drizzle-orm";
import { experienceExperiments } from "../../schema";
import { safeJsonParse } from "../../../services/infra/safe-json-parse";

export type ExperimentVerdict = "promising" | "reject" | "inconclusive";

export interface ExperienceExperiment {
  id: string;
  experienceId: string;
  configHash: string;
  datasetWindowStart: string | null;
  datasetWindowEnd: string | null;
  metrics: Record<string, unknown>;
  notes: string;
  verdict: ExperimentVerdict;
  createdAt: string;
}

export class ExperienceExperimentsRepo {
  constructor(private readonly client: DbClient) {}

  listByExperience(experienceId: string): ExperienceExperiment[] {
    const rows = this.client.db
      .select()
      .from(experienceExperiments)
      .where(eq(experienceExperiments.experienceId, experienceId))
      .orderBy(desc(experienceExperiments.createdAt))
      .all();
    return rows.map(toExperiment);
  }

  insert(
    input: Omit<ExperienceExperiment, "createdAt"> & { createdAt?: string },
  ) {
    const createdAt = input.createdAt ?? new Date().toISOString();
    this.client.db
      .insert(experienceExperiments)
      .values({
        id: input.id,
        experienceId: input.experienceId,
        configHash: input.configHash,
        datasetWindowStart: input.datasetWindowStart,
        datasetWindowEnd: input.datasetWindowEnd,
        metricsJson: JSON.stringify(input.metrics),
        notes: input.notes,
        verdict: input.verdict,
        createdAt,
      })
      .run();
    return { ...input, createdAt };
  }

  getById(id: string): ExperienceExperiment | null {
    const row = this.client.db
      .select()
      .from(experienceExperiments)
      .where(eq(experienceExperiments.id, id))
      .get();
    return row ? toExperiment(row) : null;
  }

  compare(
    experimentIdA: string,
    experimentIdB: string,
  ): {
    a: ExperienceExperiment;
    b: ExperienceExperiment;
    metricDiffs: Record<
      string,
      { a: unknown; b: unknown; delta: number | null }
    >;
  } | null {
    const a = this.getById(experimentIdA);
    const b = this.getById(experimentIdB);
    if (!a || !b) return null;
    const keys = new Set([
      ...Object.keys(a.metrics),
      ...Object.keys(b.metrics),
    ]);
    const metricDiffs: Record<
      string,
      { a: unknown; b: unknown; delta: number | null }
    > = {};
    for (const key of keys) {
      const av = a.metrics[key];
      const bv = b.metrics[key];
      const delta =
        typeof av === "number" && typeof bv === "number" ? bv - av : null;
      metricDiffs[key] = { a: av, b: bv, delta };
    }
    return { a, b, metricDiffs };
  }
}

function toExperiment(
  row: typeof experienceExperiments.$inferSelect,
): ExperienceExperiment {
  const metrics =
    safeJsonParse<Record<string, unknown>>(
      row.metricsJson,
      undefined,
      "experience-experiments.metrics",
    ) ?? {};
  return {
    id: row.id,
    experienceId: row.experienceId,
    configHash: row.configHash,
    datasetWindowStart: row.datasetWindowStart,
    datasetWindowEnd: row.datasetWindowEnd,
    metrics,
    notes: row.notes,
    verdict: row.verdict as ExperimentVerdict,
    createdAt: row.createdAt,
  };
}
