import { describe, expect, it } from "vitest";
import { PIPELINE_PHASES } from "@electron/shared/ai/ai-phase";
import { createTestDb } from "../../test-helpers";
import { createMinimalSession } from "../../test-fixtures";
import { SessionAiPhasesRepo } from "./session-ai-phases-repo";

describe("SessionAiPhasesRepo", () => {
  it("lists seeded phases and upserts phase and worker config", () => {
    const db = createTestDb();
    const repo = new SessionAiPhasesRepo(db);
    const session = createMinimalSession(db);

    const phases = repo.listBySession(session.id);
    expect(phases).toHaveLength(PIPELINE_PHASES.length);

    repo.upsertPhase(session.id, {
      phase: "selector",
      providerKey: "provider-test",
      modelId: "model-test",
      temperature: 0.2,
    });
    expect(repo.getByPhase(session.id, "selector")).toMatchObject({
      providerKey: "provider-test",
      modelId: "model-test",
      temperature: 0.2,
    });

    repo.upsertWorker(session.id, {
      sessionId: session.id,
      phase: "selector",
      workerId: "worker-1",
      providerKey: "provider-worker",
      modelId: "model-worker",
      maxSteps: 5,
      spendLimitUsd: 1.5,
      promptMarkdown: "Custom prompt",
      updatedAt: new Date().toISOString(),
    });
    expect(repo.listWorkersBySession(session.id)).toMatchObject([
      { workerId: "worker-1", maxSteps: 5 },
    ]);

    db.sqlite.close();
  });
});
