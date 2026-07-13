import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { channels } from "@electron/shared/ipc/channels";
import { createMinimalSession } from "../../db/test-fixtures";
import { createTestDb } from "../../db/test-helpers";
import {
  createIpcTestServices,
  invokeIpc,
  registerPhase4IpcHandlers,
  resetIpcHandlers,
} from "./ipc-test-harness";

describe("strategy IPC handlers", () => {
  let db = createTestDb();
  let harness = createIpcTestServices(db);
  let sessionId = "";

  beforeEach(() => {
    db = createTestDb();
    harness = createIpcTestServices(db);
    resetIpcHandlers();
    registerPhase4IpcHandlers(harness.services);
    harness.configureAiProvider();
    sessionId = createMinimalSession(db, { experienceId: "edgar-catalyst" }).id;
    harness.services.repos.session.setFocus(sessionId);
  });

  afterEach(() => {
    harness.cleanup();
    resetIpcHandlers();
  });

  it("strategy:get returns aggregated strategy page data", async () => {
    const page = await invokeIpc<{
      researchPosture: { posturePresetId: string };
      riskConfig: { maxPositionUsd: number };
      sessionStatus: string;
    }>(channels.strategy.get, { sessionId });

    expect(page.researchPosture.posturePresetId).toBe("edgar_catalyst");
    expect(page.riskConfig.maxPositionUsd).toBeGreaterThan(0);
    expect(page.sessionStatus).toBe("draft");
  });

  it("strategy:get-provider-models returns empty for unknown provider", async () => {
    const result = await invokeIpc<{ models: unknown[] }>(
      channels.strategy.getProviderModels,
      { providerKey: "missing-provider" },
    );
    expect(result.models).toEqual([]);
  });
});
