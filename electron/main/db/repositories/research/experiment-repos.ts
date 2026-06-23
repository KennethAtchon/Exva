import { asc, desc, eq } from "drizzle-orm";
import type { DbClient } from "../../client";
import {
  backtestRuns,
  modelVersions,
  promotionDecisions,
} from "../../schema";
import type {
  BacktestRun,
  BacktestVerdict,
  ModelVersion,
  PromotionDecision,
  ResearchTier,
} from "@electron/shared/domain";

export class ModelVersionsRepo {
  constructor(private readonly client: DbClient) {}

  insert(version: ModelVersion): void {
    this.client.db.insert(modelVersions).values(version).run();
  }

  get(id: string): ModelVersion | null {
    return (
      this.client.db
        .select()
        .from(modelVersions)
        .where(eq(modelVersions.id, id))
        .get() ?? null
    );
  }

  listByExperience(experienceId: string): ModelVersion[] {
    return this.client.db
      .select()
      .from(modelVersions)
      .where(eq(modelVersions.experienceId, experienceId))
      .orderBy(desc(modelVersions.createdAt))
      .all();
  }

  latest(experienceId: string): ModelVersion | null {
    return (
      this.client.db
        .select()
        .from(modelVersions)
        .where(eq(modelVersions.experienceId, experienceId))
        .orderBy(desc(modelVersions.createdAt))
        .get() ?? null
    );
  }
}

export class BacktestRunsRepo {
  constructor(private readonly client: DbClient) {}

  insert(run: BacktestRun): void {
    this.client.db.insert(backtestRuns).values(run).run();
  }

  listByExperience(experienceId: string): BacktestRun[] {
    return this.client.db
      .select()
      .from(backtestRuns)
      .where(eq(backtestRuns.experienceId, experienceId))
      .orderBy(asc(backtestRuns.createdAt))
      .all()
      .map((row) => ({ ...row, verdict: row.verdict as BacktestVerdict }));
  }
}

export class PromotionDecisionsRepo {
  constructor(private readonly client: DbClient) {}

  insert(decision: PromotionDecision): void {
    this.client.db.insert(promotionDecisions).values(decision).run();
  }

  listByExperience(experienceId: string): PromotionDecision[] {
    return this.client.db
      .select()
      .from(promotionDecisions)
      .where(eq(promotionDecisions.experienceId, experienceId))
      .orderBy(desc(promotionDecisions.decidedAt))
      .all()
      .map((row) => ({
        ...row,
        fromTier: row.fromTier as ResearchTier,
        toTier: row.toTier as ResearchTier,
        decision: row.decision as PromotionDecision["decision"],
      }));
  }

  latestTier(experienceId: string): ResearchTier {
    const row = this.client.db
      .select()
      .from(promotionDecisions)
      .where(eq(promotionDecisions.experienceId, experienceId))
      .orderBy(desc(promotionDecisions.decidedAt))
      .get();
    if (!row || row.decision !== "approved") return "research";
    return row.toTier as ResearchTier;
  }
}
