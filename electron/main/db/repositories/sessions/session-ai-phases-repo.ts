import { and, eq } from "drizzle-orm";
import { AppError } from "@electron/shared/infra/errors";
import type {
  PipelinePhase,
  SessionAiPhase,
  SessionAiPhaseWorker,
} from "@electron/shared/ai/ai-phase";
import { sessionAiPhases, sessionAiPhaseWorkers } from "../../schema";
import type { DbClient } from "../../client";

function toSessionAiPhase(
  row: typeof sessionAiPhases.$inferSelect,
): SessionAiPhase {
  return {
    sessionId: row.sessionId,
    phase: row.phase as PipelinePhase,
    providerKey: row.providerKey,
    modelId: row.modelId,
    temperature: row.temperature,
    maxTokens: row.maxTokens,
    reasoningLevel: row.reasoningLevel as SessionAiPhase["reasoningLevel"],
    promptSource: row.promptSource as "default" | "session_override",
    promptMarkdown: row.promptMarkdown,
    updatedAt: row.updatedAt,
  };
}

function toSessionAiPhaseWorker(
  row: typeof sessionAiPhaseWorkers.$inferSelect,
): SessionAiPhaseWorker {
  return {
    sessionId: row.sessionId,
    phase: row.phase as PipelinePhase,
    workerId: row.workerId,
    providerKey: row.providerKey ?? null,
    modelId: row.modelId ?? null,
    maxSteps: row.maxSteps ?? null,
    spendLimitUsd: row.spendLimitUsd ?? null,
    promptMarkdown: row.promptMarkdown ?? null,
    updatedAt: row.updatedAt,
  };
}

export class SessionAiPhasesRepo {
  constructor(private readonly client: DbClient) {}

  listBySession(sessionId: string): SessionAiPhase[] {
    const rows = this.client.db
      .select()
      .from(sessionAiPhases)
      .where(eq(sessionAiPhases.sessionId, sessionId))
      .all();
    return rows.map(toSessionAiPhase);
  }

  getByPhase(sessionId: string, phase: PipelinePhase): SessionAiPhase | null {
    const row = this.client.db
      .select()
      .from(sessionAiPhases)
      .where(
        and(
          eq(sessionAiPhases.sessionId, sessionId),
          eq(sessionAiPhases.phase, phase),
        ),
      )
      .get();
    return row ? toSessionAiPhase(row) : null;
  }

  requireByPhase(sessionId: string, phase: PipelinePhase): SessionAiPhase {
    const phaseConfig = this.getByPhase(sessionId, phase);
    if (!phaseConfig) {
      throw new AppError(
        `AI phase config for session ${sessionId} phase ${phase} was not found`,
        "NOT_FOUND",
        { sessionId, phase },
      );
    }
    return phaseConfig;
  }

  upsertPhase(
    sessionId: string,
    patch: Partial<SessionAiPhase> & { phase: PipelinePhase },
  ): void {
    const now = new Date().toISOString();
    this.client.db
      .insert(sessionAiPhases)
      .values({
        sessionId,
        phase: patch.phase,
        providerKey: patch.providerKey ?? "",
        modelId: patch.modelId ?? "",
        temperature: patch.temperature ?? 0.7,
        maxTokens: patch.maxTokens ?? 8192,
        reasoningLevel: patch.reasoningLevel ?? "off",
        promptSource: patch.promptSource ?? "default",
        promptMarkdown: patch.promptMarkdown ?? "",
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [sessionAiPhases.sessionId, sessionAiPhases.phase],
        set: {
          providerKey: patch.providerKey,
          modelId: patch.modelId,
          temperature: patch.temperature,
          maxTokens: patch.maxTokens,
          reasoningLevel: patch.reasoningLevel,
          promptSource: patch.promptSource,
          promptMarkdown: patch.promptMarkdown,
          updatedAt: now,
        },
      })
      .run();
  }

  backfillMissingProviderModel(defaults: {
    providerKey: string;
    modelId: string;
  }): number {
    if (!defaults.providerKey.trim() || !defaults.modelId.trim()) return 0;
    const rows = this.client.db.select().from(sessionAiPhases).all();
    let updated = 0;
    this.client.db.transaction((tx) => {
      for (const row of rows) {
        if (row.providerKey?.trim() && row.modelId?.trim()) continue;
        tx.update(sessionAiPhases)
          .set({ providerKey: defaults.providerKey, modelId: defaults.modelId })
          .where(
            and(
              eq(sessionAiPhases.sessionId, row.sessionId),
              eq(sessionAiPhases.phase, row.phase),
            ),
          )
          .run();
        updated += 1;
      }
    });
    return updated;
  }

  backfillDefaultReasoningLevel(reasoningLevel: SessionAiPhase["reasoningLevel"]): number {
    if (reasoningLevel === "off") return 0;
    const rows = this.client.db.select().from(sessionAiPhases).all();
    let updated = 0;
    this.client.db.transaction((tx) => {
      for (const row of rows) {
        if (row.reasoningLevel !== "off") continue;
        tx.update(sessionAiPhases)
          .set({ reasoningLevel })
          .where(
            and(
              eq(sessionAiPhases.sessionId, row.sessionId),
              eq(sessionAiPhases.phase, row.phase),
            ),
          )
          .run();
        updated += 1;
      }
    });
    return updated;
  }

  listWorkersBySession(sessionId: string): SessionAiPhaseWorker[] {
    const rows = this.client.db
      .select()
      .from(sessionAiPhaseWorkers)
      .where(eq(sessionAiPhaseWorkers.sessionId, sessionId))
      .all();
    return rows.map(toSessionAiPhaseWorker);
  }

  getWorker(
    sessionId: string,
    phase: PipelinePhase,
    workerId: string,
  ): SessionAiPhaseWorker | null {
    const row = this.client.db
      .select()
      .from(sessionAiPhaseWorkers)
      .where(
        and(
          eq(sessionAiPhaseWorkers.sessionId, sessionId),
          eq(sessionAiPhaseWorkers.phase, phase),
          eq(sessionAiPhaseWorkers.workerId, workerId),
        ),
      )
      .get();
    return row ? toSessionAiPhaseWorker(row) : null;
  }

  upsertWorker(sessionId: string, patch: SessionAiPhaseWorker): void {
    const now = new Date().toISOString();
    this.client.db
      .insert(sessionAiPhaseWorkers)
      .values({
        sessionId,
        phase: patch.phase,
        workerId: patch.workerId,
        providerKey: patch.providerKey ?? null,
        modelId: patch.modelId ?? null,
        maxSteps: patch.maxSteps ?? null,
        spendLimitUsd: patch.spendLimitUsd ?? null,
        promptMarkdown: patch.promptMarkdown ?? null,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          sessionAiPhaseWorkers.sessionId,
          sessionAiPhaseWorkers.phase,
          sessionAiPhaseWorkers.workerId,
        ],
        set: {
          providerKey: patch.providerKey ?? null,
          modelId: patch.modelId ?? null,
          maxSteps: patch.maxSteps ?? null,
          spendLimitUsd: patch.spendLimitUsd ?? null,
          promptMarkdown: patch.promptMarkdown ?? null,
          updatedAt: now,
        },
      })
      .run();
  }
}
