import { eq, and } from "drizzle-orm";
import type { DbClient } from "../../db/client";
import {
  instrumentSets,
  instrumentSetRevisions,
  instrumentSetMembers,
} from "../../db/schema";
import type {
  InstrumentSetRevision,
  InstrumentSetMember,
  InstrumentSetStatus,
  InstrumentSetMode,
} from "@electron/shared/domain/experience-inputs/catalog";
import type { InstrumentClass } from "@electron/shared/domain/enums";

export interface InstrumentSetCreateInput {
  setId: string;
  name: string;
  instrumentClass: InstrumentClass;
  mode: InstrumentSetMode;
  status: InstrumentSetStatus;
  members: Array<{
    canonicalId: string;
    displaySymbol: string;
    venue?: string | null;
  }>;
}

export class InstrumentSetRepo {
  constructor(private readonly db: DbClient) {}

  ensureSet(setId: string): void {
    const now = new Date().toISOString();
    this.db.db
      .insert(instrumentSets)
      .values({ id: setId, createdAt: now, updatedAt: now })
      .onConflictDoNothing()
      .run();
  }

  getRevision(setId: string, revision: number): InstrumentSetRevision | null {
    const row = this.db.db
      .select()
      .from(instrumentSetRevisions)
      .where(
        and(
          eq(instrumentSetRevisions.setId, setId),
          eq(instrumentSetRevisions.revision, revision),
        ),
      )
      .get();
    if (!row) return null;
    return {
      ...rowToRevision(row),
      members: this.listMembers(setId, revision),
    };
  }

  getActiveRevision(setId: string): InstrumentSetRevision | null {
    const row = this.db.db
      .select()
      .from(instrumentSetRevisions)
      .where(
        and(
          eq(instrumentSetRevisions.setId, setId),
          eq(instrumentSetRevisions.status, "active"),
        ),
      )
      .get();
    if (!row) return null;
    return {
      ...rowToRevision(row),
      members: this.listMembers(setId, row.revision),
    };
  }

  listMembers(setId: string, revision: number): InstrumentSetMember[] {
    return this.db.db
      .select()
      .from(instrumentSetMembers)
      .where(
        and(
          eq(instrumentSetMembers.setId, setId),
          eq(instrumentSetMembers.setRevision, revision),
        ),
      )
      .all()
      .map((m) => ({
        canonicalId: m.canonicalId,
        displaySymbol: m.displaySymbol,
        venue: m.venue,
      }));
  }

  list(): InstrumentSetRevision[] {
    const sets = this.db.db.select().from(instrumentSets).all();
    return sets.flatMap((s) => {
      const rev = this.getActiveRevision(s.id);
      return rev ? [rev] : [];
    });
  }

  /**
   * Create a new revision for the given set. Active revisions are immutable —
   * always create a new revision to make changes.
   */
  createRevision(
    input: InstrumentSetCreateInput & { revision: number },
  ): InstrumentSetRevision {
    const now = new Date().toISOString();
    this.db.db
      .insert(instrumentSetRevisions)
      .values({
        setId: input.setId,
        revision: input.revision,
        status: input.status,
        name: input.name,
        instrumentClass: input.instrumentClass,
        mode: input.mode,
        createdAt: now,
      })
      .run();

    for (const member of input.members) {
      this.db.db
        .insert(instrumentSetMembers)
        .values({
          setId: input.setId,
          setRevision: input.revision,
          canonicalId: member.canonicalId,
          displaySymbol: member.displaySymbol,
          venue: member.venue ?? null,
        })
        .run();
    }

    const saved = this.getRevision(input.setId, input.revision);
    if (!saved) {
      throw new Error(
        `InstrumentSetRepo: revision (${input.setId}, r${input.revision}) not found after insert`,
      );
    }
    return saved;
  }

  /** Idempotent seed helper: insert revision 1 if absent. */
  createRevisionIfAbsent(
    input: InstrumentSetCreateInput,
  ): InstrumentSetRevision {
    const existing = this.getRevision(input.setId, 1);
    if (existing) return existing;
    this.ensureSet(input.setId);
    return this.createRevision({ ...input, revision: 1 });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type RevisionRow = typeof instrumentSetRevisions.$inferSelect;

function rowToRevision(
  row: RevisionRow,
): Omit<InstrumentSetRevision, "members"> {
  return {
    setId: row.setId,
    revision: row.revision,
    status: row.status as InstrumentSetStatus,
    name: row.name,
    instrumentClass: row.instrumentClass as InstrumentClass,
    mode: row.mode as InstrumentSetMode,
  };
}
