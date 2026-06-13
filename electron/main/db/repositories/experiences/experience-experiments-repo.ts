import type { DbClient } from "../../client";
import { desc, eq } from "drizzle-orm";
import { experienceExperiments } from "../../schema";

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
}

function toExperiment(
  row: typeof experienceExperiments.$inferSelect,
): ExperienceExperiment {
  let metrics: Record<string, unknown> = {};
  try {
    metrics = JSON.parse(row.metricsJson) as Record<string, unknown>;
  } catch {
    metrics = {};
  }
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
