import { asc, desc, eq } from "drizzle-orm";
import type { DbClient } from "../../client";
import { backtestRuns, modelVersions, promotionDecisions } from "../../schema";
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

  getById(id: string): BacktestRun | null {
    const row = this.client.db
      .select()
      .from(backtestRuns)
      .where(eq(backtestRuns.id, id))
      .get();
    if (!row) return null;
    return { ...row, verdict: row.verdict as BacktestVerdict };
  }

  listRecent(limit = 50): BacktestRun[] {
    return this.client.db
      .select()
      .from(backtestRuns)
      .orderBy(desc(backtestRuns.createdAt))
      .limit(limit)
      .all()
      .map((row) => ({ ...row, verdict: row.verdict as BacktestVerdict }));
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

  /**
   * Most recent backtest for an experience, optionally filtered by verdict
   * and/or contract hash.
   */
  latestForExperience(
    experienceId: string,
    filter?: { verdict?: BacktestVerdict; contractHash?: string },
  ): BacktestRun | null {
    const rows = this.listByExperience(experienceId);
    for (let i = rows.length - 1; i >= 0; i--) {
      const row = rows[i];
      if (!row) continue;
      if (filter?.verdict != null && row.verdict !== filter.verdict) continue;
      if (
        filter?.contractHash != null &&
        row.contractHash !== filter.contractHash
      ) {
        continue;
      }
      return row;
    }
    return null;
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
