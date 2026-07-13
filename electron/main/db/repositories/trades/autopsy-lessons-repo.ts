import type { DbClient } from "../../client";
import type {
  AutopsyLessonSource,
  AutopsyLesson,
  AutopsyScope,
  LessonStatus,
} from "@electron/shared/domain/autopsy";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { autopsyLessons } from "../../schema";
import { AppError } from "@electron/shared/infra/errors";

function toLesson(row: typeof autopsyLessons.$inferSelect): AutopsyLesson {
  return {
    id: row.id,
    autopsyId: row.autopsyId,
    tradeId: row.tradeId,
    sessionId: row.sessionId,
    lesson: row.lesson,
    severity: row.severity as AutopsyLesson["severity"],
    category: row.category as AutopsyLesson["category"],
    proposedFix: row.proposedFix,
    status: row.status as LessonStatus,
    recurrenceCount: row.recurrenceCount,
    source: row.source as AutopsyLessonSource,
    scope: row.scope as AutopsyScope,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    validatedAt: row.validatedAt,
  };
}

export class AutopsyLessonsRepo {
  constructor(private readonly client: DbClient) {}

  listByAutopsy(autopsyId: string): AutopsyLesson[] {
    const rows = this.client.db
      .select()
      .from(autopsyLessons)
      .where(eq(autopsyLessons.autopsyId, autopsyId))
      .orderBy(desc(autopsyLessons.createdAt))
      .all();
    return rows.map(toLesson);
  }

  /** @deprecated Prefer listByAutopsy — period runs share the same FK. */
  listByPeriodAutopsy(periodAutopsyId: string): AutopsyLesson[] {
    return this.listByAutopsy(periodAutopsyId);
  }

  listBySession(sessionId: string, statuses?: LessonStatus[]): AutopsyLesson[] {
    const conditions = [eq(autopsyLessons.sessionId, sessionId)];
    if (statuses?.length) {
      conditions.push(inArray(autopsyLessons.status, statuses));
    }
    const rows = this.client.db
      .select()
      .from(autopsyLessons)
      .where(and(...conditions))
      .orderBy(desc(autopsyLessons.createdAt))
      .all();
    return rows.map(toLesson);
  }

  listByScope(input: {
    scope: AutopsyScope;
    sessionId?: string | null;
    statuses?: LessonStatus[];
    sources?: AutopsyLessonSource[];
  }): AutopsyLesson[] {
    const conditions = [eq(autopsyLessons.scope, input.scope)];
    if (input.scope === "session") {
      if (!input.sessionId) {
        throw new AppError(
          "sessionId is required for session-scoped lessons.",
          "VALIDATION_FAILED",
        );
      }
      conditions.push(eq(autopsyLessons.sessionId, input.sessionId));
    } else {
      conditions.push(sql`${autopsyLessons.sessionId} IS NULL`);
    }
    if (input.statuses?.length) {
      conditions.push(inArray(autopsyLessons.status, input.statuses));
    }
    if (input.sources?.length) {
      conditions.push(inArray(autopsyLessons.source, input.sources));
    }
    const rows = this.client.db
      .select()
      .from(autopsyLessons)
      .where(and(...conditions))
      .orderBy(desc(autopsyLessons.createdAt))
      .all();
    return rows.map(toLesson);
  }

  findSimilar(input: {
    scope: AutopsyScope;
    sessionId?: string | null;
    lesson: string;
    sources?: AutopsyLessonSource[];
  }): AutopsyLesson | null {
    const normalized = input.lesson.trim().toLowerCase();
    const matches = this.listByScope({
      scope: input.scope,
      sessionId: input.sessionId,
      sources: input.sources,
    });
    return (
      matches.find(
        (lesson) => lesson.lesson.trim().toLowerCase() === normalized,
      ) ?? null
    );
  }

  insert(lesson: Omit<AutopsyLesson, "id"> & { id?: string }): AutopsyLesson {
    const id = lesson.id ?? crypto.randomUUID();
    this.client.db
      .insert(autopsyLessons)
      .values({
        id,
        autopsyId: lesson.autopsyId,
        tradeId: lesson.tradeId,
        sessionId: lesson.sessionId,
        lesson: lesson.lesson,
        severity: lesson.severity,
        category: lesson.category,
        proposedFix: lesson.proposedFix,
        status: lesson.status,
        recurrenceCount: lesson.recurrenceCount,
        source: lesson.source,
        scope: lesson.scope,
        createdAt: lesson.createdAt,
        updatedAt: lesson.updatedAt,
        validatedAt: lesson.validatedAt,
      })
      .run();
    return this.require(id);
  }

  update(
    id: string,
    patch: Partial<
      Pick<
        AutopsyLesson,
        | "status"
        | "lesson"
        | "proposedFix"
        | "recurrenceCount"
        | "validatedAt"
        | "updatedAt"
      >
    >,
  ): AutopsyLesson {
    this.client.db
      .update(autopsyLessons)
      .set({
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.lesson !== undefined ? { lesson: patch.lesson } : {}),
        ...(patch.proposedFix !== undefined
          ? { proposedFix: patch.proposedFix }
          : {}),
        ...(patch.recurrenceCount !== undefined
          ? { recurrenceCount: patch.recurrenceCount }
          : {}),
        ...(patch.validatedAt !== undefined
          ? { validatedAt: patch.validatedAt }
          : {}),
        updatedAt: patch.updatedAt ?? new Date().toISOString(),
      })
      .where(eq(autopsyLessons.id, id))
      .run();
    return this.require(id);
  }

  find(id: string): AutopsyLesson | null {
    const row = this.client.db
      .select()
      .from(autopsyLessons)
      .where(eq(autopsyLessons.id, id))
      .get();
    return row ? toLesson(row) : null;
  }

  require(id: string): AutopsyLesson {
    const lesson = this.find(id);
    if (!lesson) {
      throw new AppError(`Autopsy lesson ${id} was not found`, "NOT_FOUND");
    }
    return lesson;
  }
}
