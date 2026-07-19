import { desc, eq } from "drizzle-orm";
import type { DbClient } from "../../client";
import { sessionActivity, sessionActivityTransitions } from "../../schema";
import type {
  SessionActivityCondition,
  SessionActivitySnapshot,
} from "@electron/shared/domain/session-activity";
import { safeJsonParse } from "../../../services/infra/safe-json-parse";

function toSnapshot(row: {
  sessionId: string;
  activity: string;
  conditionsJson: string;
  updatedAt: string;
}): SessionActivitySnapshot {
  return {
    sessionId: row.sessionId,
    activity: row.activity,
    conditions:
      safeJsonParse<SessionActivityCondition[]>(
        row.conditionsJson,
        undefined,
        "session-activity.conditions",
      ) ?? [],
    updatedAt: row.updatedAt,
  };
}

export class SessionActivityRepo {
  constructor(private readonly db: DbClient) {}

  get(sessionId: string): SessionActivitySnapshot | null {
    const row = this.db.db
      .select()
      .from(sessionActivity)
      .where(eq(sessionActivity.sessionId, sessionId))
      .get();
    return row ? toSnapshot(row) : null;
  }

  list(): SessionActivitySnapshot[] {
    return this.db.db
      .select()
      .from(sessionActivity)
      .all()
      .map(toSnapshot);
  }

  /** Upserts current state and appends an immutable transition record. */
  set(snapshot: Omit<SessionActivitySnapshot, "updatedAt">): SessionActivitySnapshot {
    const now = new Date().toISOString();
    const conditionsJson = JSON.stringify(snapshot.conditions);

    this.db.db
      .insert(sessionActivity)
      .values({
        sessionId: snapshot.sessionId,
        activity: snapshot.activity,
        conditionsJson,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: sessionActivity.sessionId,
        set: { activity: snapshot.activity, conditionsJson, updatedAt: now },
      })
      .run();

    this.db.db
      .insert(sessionActivityTransitions)
      .values({
        id: crypto.randomUUID(),
        sessionId: snapshot.sessionId,
        activity: snapshot.activity,
        conditionsJson,
        createdAt: now,
      })
      .run();

    return { ...snapshot, updatedAt: now };
  }

  listTransitions(
    sessionId: string,
    limit = 50,
  ): SessionActivitySnapshot[] {
    return this.db.db
      .select()
      .from(sessionActivityTransitions)
      .where(eq(sessionActivityTransitions.sessionId, sessionId))
      .orderBy(desc(sessionActivityTransitions.createdAt))
      .limit(limit)
      .all()
      .map((row) =>
        toSnapshot({
          sessionId: row.sessionId,
          activity: row.activity,
          conditionsJson: row.conditionsJson,
          updatedAt: row.createdAt,
        }),
      );
  }
}
