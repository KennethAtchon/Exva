import type { DbClient } from "../client";
import type { ExecutionStage, ExecutionStepState, ExecutionStepStatus } from "@/lib/types";
import { and, desc, eq, inArray } from "drizzle-orm";
import { sessionExecutionSteps } from "../schema";
import { toExecutionStepState } from "./mappers";

export interface SessionExecutionStepsRepo {
  upsert(step: Omit<ExecutionStepState, "id" | "createdAt" | "updatedAt">): ExecutionStepState;
  get(sessionId: string, cycleId: string, stage: ExecutionStage): ExecutionStepState | null;
  getLatestByCycle(sessionId: string, cycleId: string): ExecutionStepState[];
  getLatestBySession(sessionId: string): ExecutionStepState[];
  getLatestCycleState(sessionId: string): { cycleId: string | null; steps: ExecutionStepState[] };
  clearFailed(sessionId: string, cycleId: string, stage: ExecutionStage): void;
}

const ACTIVE_STEP_STATUSES: ExecutionStepStatus[] = ["failed", "retrying"];

export class SqliteSessionExecutionStepsRepo implements SessionExecutionStepsRepo {
  constructor(private readonly client: DbClient) {}

  upsert(step: Omit<ExecutionStepState, "id" | "createdAt" | "updatedAt">): ExecutionStepState {
    const now = new Date().toISOString();
    const existing = this.get(step.sessionId, step.cycleId, step.stage);
    const id = existing?.id ?? crypto.randomUUID();
    const createdAt = existing?.createdAt ?? now;

    this.client.db
      .insert(sessionExecutionSteps)
      .values({
        id,
        sessionId: step.sessionId,
        cycleId: step.cycleId,
        stage: step.stage,
        status: step.status,
        attempt: step.attempt,
        startedAt: step.startedAt,
        completedAt: step.completedAt,
        nextRetryAt: step.nextRetryAt,
        lastErrorCode: step.lastErrorCode,
        lastErrorMessage: step.lastErrorMessage,
        retryable: step.retryable,
        createdAt,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [sessionExecutionSteps.sessionId, sessionExecutionSteps.cycleId, sessionExecutionSteps.stage],
        set: {
          status: step.status,
          attempt: step.attempt,
          startedAt: step.startedAt,
          completedAt: step.completedAt,
          nextRetryAt: step.nextRetryAt,
          lastErrorCode: step.lastErrorCode,
          lastErrorMessage: step.lastErrorMessage,
          retryable: step.retryable,
          updatedAt: now,
        },
      })
      .run();

    const row = this.get(step.sessionId, step.cycleId, step.stage);
    if (!row) {
      throw new Error(`Failed to read back upserted execution step ${step.sessionId}/${step.cycleId}/${step.stage}`);
    }
    return row;
  }

  get(sessionId: string, cycleId: string, stage: ExecutionStage): ExecutionStepState | null {
    const row = this.client.db
      .select()
      .from(sessionExecutionSteps)
      .where(
        and(
          eq(sessionExecutionSteps.sessionId, sessionId),
          eq(sessionExecutionSteps.cycleId, cycleId),
          eq(sessionExecutionSteps.stage, stage),
        ),
      )
      .get();
    return row ? toExecutionStepState(row) : null;
  }

  getLatestByCycle(sessionId: string, cycleId: string): ExecutionStepState[] {
    return this.client.db
      .select()
      .from(sessionExecutionSteps)
      .where(and(eq(sessionExecutionSteps.sessionId, sessionId), eq(sessionExecutionSteps.cycleId, cycleId)))
      .orderBy(desc(sessionExecutionSteps.updatedAt))
      .all()
      .map(toExecutionStepState);
  }

  getLatestBySession(sessionId: string): ExecutionStepState[] {
    const rows = this.client.db
      .select()
      .from(sessionExecutionSteps)
      .where(eq(sessionExecutionSteps.sessionId, sessionId))
      .orderBy(desc(sessionExecutionSteps.updatedAt))
      .all()
      .map(toExecutionStepState);

    const latestByStage = new Map<ExecutionStage, ExecutionStepState>();
    for (const row of rows) {
      if (!latestByStage.has(row.stage)) latestByStage.set(row.stage, row);
    }
    return [...latestByStage.values()];
  }

  getLatestCycleState(sessionId: string): { cycleId: string | null; steps: ExecutionStepState[] } {
    const rows = this.client.db
      .select()
      .from(sessionExecutionSteps)
      .where(eq(sessionExecutionSteps.sessionId, sessionId))
      .orderBy(desc(sessionExecutionSteps.updatedAt))
      .all()
      .map(toExecutionStepState);

    const cycleId = rows[0]?.cycleId ?? null;
    if (!cycleId) return { cycleId: null, steps: [] };
    return { cycleId, steps: rows.filter((r) => r.cycleId === cycleId) };
  }

  clearFailed(sessionId: string, cycleId: string, stage: ExecutionStage): void {
    this.client.db
      .delete(sessionExecutionSteps)
      .where(
        and(
          eq(sessionExecutionSteps.sessionId, sessionId),
          eq(sessionExecutionSteps.cycleId, cycleId),
          eq(sessionExecutionSteps.stage, stage),
          inArray(sessionExecutionSteps.status, ACTIVE_STEP_STATUSES),
        ),
      )
      .run();
  }
}
