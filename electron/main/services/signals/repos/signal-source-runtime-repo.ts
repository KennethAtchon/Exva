import { desc, eq } from "drizzle-orm";
import type { DbClient } from "../../../db/client";
import {
  signalSourcePolls,
  signalSourceRuntimeStates,
} from "../../../db/schema";
import type {
  RecordSignalSourcePollInput,
  SignalSourcePollHistoryEntry,
  SignalSourcePollOutcome,
  SignalSourceRuntimeState,
} from "@electron/shared/domain/signal-source-health";
import type { SignalSourceRuntimeStatus } from "@electron/shared/domain";
import { safeJsonParse } from "../../infra/safe-json-parse";

function parseErrors(json: string): string[] {
  const parsed = safeJsonParse<string[]>(json, undefined, "source-poll.errors");
  return Array.isArray(parsed) ? parsed.filter((e) => typeof e === "string") : [];
}

function parseDropReasons(
  json: string | null,
): Record<string, number> | undefined {
  if (!json) return undefined;
  const parsed = safeJsonParse<Record<string, unknown>>(
    json,
    undefined,
    "source-poll.drop-reasons",
  );
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return undefined;
  }

  const reasons: Record<string, number> = {};
  for (const [reason, count] of Object.entries(parsed)) {
    if (typeof count === "number" && Number.isFinite(count)) {
      reasons[reason] = count;
    }
  }
  return Object.keys(reasons).length > 0 ? reasons : undefined;
}

function toRuntimeState(row: {
  sourceId: string;
  status: string;
  lastPollAt: string | null;
  lastSuccessAt: string | null;
  consecutiveFailures: number;
  lastError: string | null;
  lastOutcome: string | null;
  httpStatus: number | null;
  detected: number;
  passed: number;
  dropped: number;
  errorsJson: string;
  updatedAt: string;
}): SignalSourceRuntimeState {
  return {
    sourceId: row.sourceId,
    status: row.status as SignalSourceRuntimeStatus,
    lastPollAt: row.lastPollAt,
    lastSuccessAt: row.lastSuccessAt,
    consecutiveFailures: row.consecutiveFailures,
    lastError: row.lastError,
    lastOutcome: row.lastOutcome as SignalSourcePollOutcome | null,
    httpStatus: row.httpStatus,
    detected: row.detected,
    passed: row.passed,
    dropped: row.dropped,
    errors: parseErrors(row.errorsJson),
    updatedAt: row.updatedAt,
  };
}

export class SignalSourceRuntimeRepo {
  constructor(private readonly db: DbClient) {}

  get(sourceId: string): SignalSourceRuntimeState | null {
    const row = this.db.db
      .select()
      .from(signalSourceRuntimeStates)
      .where(eq(signalSourceRuntimeStates.sourceId, sourceId))
      .get();
    return row ? toRuntimeState(row) : null;
  }

  list(): SignalSourceRuntimeState[] {
    return this.db.db
      .select()
      .from(signalSourceRuntimeStates)
      .all()
      .map(toRuntimeState);
  }

  listPolls(sourceId: string, limit = 50): SignalSourcePollHistoryEntry[] {
    return this.db.db
      .select()
      .from(signalSourcePolls)
      .where(eq(signalSourcePolls.sourceId, sourceId))
      .orderBy(desc(signalSourcePolls.polledAt))
      .limit(limit)
      .all()
      .map((row) => ({
        id: row.id,
        sourceId: row.sourceId,
        polledAt: row.polledAt,
        outcome: row.outcome as SignalSourcePollOutcome,
        httpStatus: row.httpStatus,
        detected: row.detected,
        passed: row.passed,
        dropped: row.dropped,
        dropReasons: parseDropReasons(row.dropReasonsJson),
        errors: parseErrors(row.errorsJson),
        durationMs: row.durationMs,
        status: row.status as SignalSourceRuntimeStatus,
      }));
  }

  /** Upsert latest state and append an immutable poll history row. */
  recordPoll(input: RecordSignalSourcePollInput): SignalSourceRuntimeState {
    const prev = this.get(input.sourceId);
    const success = input.outcome === "success";
    const { detected, passed, dropped, dropReasons, errors } = input.result;
    const errorsJson = JSON.stringify(errors);
    const dropReasonsJson = dropReasons ? JSON.stringify(dropReasons) : null;
    const updatedAt = new Date().toISOString();

    const stateRow = {
      sourceId: input.sourceId,
      status: input.status,
      lastPollAt: input.polledAt,
      lastSuccessAt: success ? input.polledAt : (prev?.lastSuccessAt ?? null),
      consecutiveFailures: success ? 0 : (prev?.consecutiveFailures ?? 0) + 1,
      lastError: input.lastError,
      lastOutcome: input.outcome,
      httpStatus: input.httpStatus,
      detected,
      passed,
      dropped,
      errorsJson,
      updatedAt,
    };

    this.db.db
      .insert(signalSourceRuntimeStates)
      .values(stateRow)
      .onConflictDoUpdate({
        target: signalSourceRuntimeStates.sourceId,
        set: stateRow,
      })
      .run();

    this.db.db
      .insert(signalSourcePolls)
      .values({
        id: crypto.randomUUID(),
        sourceId: input.sourceId,
        polledAt: input.polledAt,
        outcome: input.outcome,
        httpStatus: input.httpStatus,
        detected,
        passed,
        dropped,
        dropReasonsJson,
        errorsJson,
        durationMs: input.durationMs,
        status: input.status,
      })
      .run();

    return toRuntimeState(stateRow);
  }
}
