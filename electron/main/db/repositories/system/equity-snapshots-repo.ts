import { and, asc, desc, gte, lte } from "drizzle-orm";
import type { DbClient } from "../../client";
import { equitySnapshots } from "../../schema";
import { safeJsonParse } from "../../../services/infra/safe-json-parse";

export interface EquitySnapshotRow {
  id: string;
  ts: string;
  total: number;
  perAccount: Record<string, number>;
  perExperience: Record<string, number>;
  aiSpendUsd: number;
  marksStale: boolean;
}

export class EquitySnapshotsRepo {
  constructor(private readonly client: DbClient) {}

  insert(row: {
    id: string;
    ts: string;
    total: number;
    perAccount: Record<string, number>;
    perExperience: Record<string, number>;
    aiSpendUsd?: number;
    marksStale?: boolean;
  }): EquitySnapshotRow {
    this.client.db
      .insert(equitySnapshots)
      .values({
        id: row.id,
        ts: row.ts,
        total: row.total,
        perAccountJson: JSON.stringify(row.perAccount),
        perExperienceJson: JSON.stringify(row.perExperience),
        aiSpendUsd: row.aiSpendUsd ?? 0,
        marksStale: row.marksStale ?? false,
      })
      .run();
    return {
      id: row.id,
      ts: row.ts,
      total: row.total,
      perAccount: row.perAccount,
      perExperience: row.perExperience,
      aiSpendUsd: row.aiSpendUsd ?? 0,
      marksStale: row.marksStale ?? false,
    };
  }

  listRange(opts: {
    fromTs?: string;
    toTs?: string;
    limit?: number;
  }): EquitySnapshotRow[] {
    const clauses = [];
    if (opts.fromTs) clauses.push(gte(equitySnapshots.ts, opts.fromTs));
    if (opts.toTs) clauses.push(lte(equitySnapshots.ts, opts.toTs));
    const q = this.client.db.select().from(equitySnapshots);
    const rows =
      clauses.length > 0
        ? q
            .where(and(...clauses))
            .orderBy(asc(equitySnapshots.ts))
            .all()
        : q.orderBy(asc(equitySnapshots.ts)).all();
    const mapped = rows.map(toSnapshot);
    if (opts.limit != null && mapped.length > opts.limit) {
      return mapped.slice(mapped.length - opts.limit);
    }
    return mapped;
  }

  latest(): EquitySnapshotRow | null {
    const row = this.client.db
      .select()
      .from(equitySnapshots)
      .orderBy(desc(equitySnapshots.ts))
      .get();
    return row ? toSnapshot(row) : null;
  }
}

function toSnapshot(
  row: typeof equitySnapshots.$inferSelect,
): EquitySnapshotRow {
  const perAccount =
    safeJsonParse<Record<string, number>>(
      row.perAccountJson,
      undefined,
      "equity-snapshots.perAccount",
    ) ?? {};
  const perExperience =
    safeJsonParse<Record<string, number>>(
      row.perExperienceJson,
      undefined,
      "equity-snapshots.perExperience",
    ) ?? {};
  return {
    id: row.id,
    ts: row.ts,
    total: row.total,
    perAccount,
    perExperience,
    aiSpendUsd: row.aiSpendUsd,
    marksStale: row.marksStale,
  };
}
