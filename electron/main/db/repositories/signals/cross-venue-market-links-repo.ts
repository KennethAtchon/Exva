import { eq, and } from "drizzle-orm";
import type { DbClient } from "../../../db/client";
import { crossVenueMarketLinks } from "../../../db/schema";

export interface CrossVenueMarketLink {
  id: string;
  polymarketId: string;
  kalshiTicker: string;
  confidence: number;
  approved: boolean;
  questionPolymarket: string | null;
  questionKalshi: string | null;
  resolutionDate: string | null;
  matchMethod: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertCrossVenueLinkInput {
  id?: string;
  polymarketId: string;
  kalshiTicker: string;
  confidence: number;
  approved?: boolean;
  questionPolymarket?: string | null;
  questionKalshi?: string | null;
  resolutionDate?: string | null;
  matchMethod?: string;
  notes?: string | null;
}

export class CrossVenueMarketLinksRepo {
  constructor(private readonly db: DbClient) {}

  list(opts?: { approvedOnly?: boolean }): CrossVenueMarketLink[] {
    const rows = this.db.db.select().from(crossVenueMarketLinks).all();
    const mapped = rows.map(mapRow);
    if (opts?.approvedOnly) return mapped.filter((r) => r.approved);
    return mapped;
  }

  get(id: string): CrossVenueMarketLink | null {
    const row = this.db.db
      .select()
      .from(crossVenueMarketLinks)
      .where(eq(crossVenueMarketLinks.id, id))
      .get();
    return row ? mapRow(row) : null;
  }

  findPair(
    polymarketId: string,
    kalshiTicker: string,
  ): CrossVenueMarketLink | null {
    const row = this.db.db
      .select()
      .from(crossVenueMarketLinks)
      .where(
        and(
          eq(crossVenueMarketLinks.polymarketId, polymarketId),
          eq(crossVenueMarketLinks.kalshiTicker, kalshiTicker),
        ),
      )
      .get();
    return row ? mapRow(row) : null;
  }

  upsert(input: UpsertCrossVenueLinkInput): CrossVenueMarketLink {
    const now = new Date().toISOString();
    const existing = this.findPair(input.polymarketId, input.kalshiTicker);
    if (existing) {
      this.db.db
        .update(crossVenueMarketLinks)
        .set({
          confidence: input.confidence,
          approved: input.approved ?? existing.approved,
          questionPolymarket:
            input.questionPolymarket ?? existing.questionPolymarket,
          questionKalshi: input.questionKalshi ?? existing.questionKalshi,
          resolutionDate: input.resolutionDate ?? existing.resolutionDate,
          matchMethod: input.matchMethod ?? existing.matchMethod,
          notes: input.notes ?? existing.notes,
          updatedAt: now,
        })
        .where(eq(crossVenueMarketLinks.id, existing.id))
        .run();
      const updated = this.get(existing.id);
      if (!updated) throw new Error("cross-venue link update vanished");
      return updated;
    }

    const id = input.id ?? crypto.randomUUID();
    this.db.db
      .insert(crossVenueMarketLinks)
      .values({
        id,
        polymarketId: input.polymarketId,
        kalshiTicker: input.kalshiTicker,
        confidence: input.confidence,
        approved: input.approved ?? false,
        questionPolymarket: input.questionPolymarket ?? null,
        questionKalshi: input.questionKalshi ?? null,
        resolutionDate: input.resolutionDate ?? null,
        matchMethod: input.matchMethod ?? "manual",
        notes: input.notes ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    const created = this.get(id);
    if (!created) throw new Error("cross-venue link insert vanished");
    return created;
  }

  setApproved(id: string, approved: boolean): CrossVenueMarketLink | null {
    const now = new Date().toISOString();
    this.db.db
      .update(crossVenueMarketLinks)
      .set({ approved, updatedAt: now })
      .where(eq(crossVenueMarketLinks.id, id))
      .run();
    return this.get(id);
  }
}

function mapRow(
  row: typeof crossVenueMarketLinks.$inferSelect,
): CrossVenueMarketLink {
  return {
    id: row.id,
    polymarketId: row.polymarketId,
    kalshiTicker: row.kalshiTicker,
    confidence: row.confidence,
    approved: row.approved,
    questionPolymarket: row.questionPolymarket,
    questionKalshi: row.questionKalshi,
    resolutionDate: row.resolutionDate,
    matchMethod: row.matchMethod,
    notes: row.notes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Heuristic question equivalence: normalize and compare token Jaccard.
 * LLM-assisted matching can write rows with matchMethod="llm"; humans approve.
 */
export function questionSimilarity(a: string, b: string): number {
  const tokensA = tokenize(a);
  const tokensB = tokenize(b);
  if (tokensA.size === 0 || tokensB.size === 0) return 0;
  let intersection = 0;
  for (const t of tokensA) if (tokensB.has(t)) intersection += 1;
  const union = tokensA.size + tokensB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function tokenize(q: string): Set<string> {
  return new Set(
    q
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 2 && !STOP.has(t)),
  );
}

const STOP = new Set([
  "the",
  "and",
  "for",
  "will",
  "be",
  "before",
  "after",
  "than",
  "with",
  "that",
  "this",
  "from",
  "have",
  "has",
  "are",
  "was",
  "were",
]);
