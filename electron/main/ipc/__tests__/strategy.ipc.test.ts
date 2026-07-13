import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { channels } from "@electron/shared/ipc/channels";
import { createMinimalSession } from "../../db/test-fixtures";
import { createTestDb } from "../../db/test-helpers";
import {
  createIpcTestServices,
  invokeIpc,
  invokeIpcError,
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
    subscribeEdgarSignal(db, sessionId);
  });

  function subscribeEdgarSignal(
    _testDb: ReturnType<typeof createTestDb>,
    _targetSessionId: string,
  ) {
    // V2: signal source subscriptions managed via session-inputs API
  }

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

  it("strategy:save-risk-config and get-risk-config round-trip", async () => {
    await invokeIpc(channels.strategy.saveRiskConfig, {
      sessionId,
      riskConfig: { maxPositionUsd: 1500, stopLossPct: 2.5 },
    });

    const risk = await invokeIpc<{
      maxPositionUsd: number;
      stopLossPct: number;
    }>(channels.strategy.getRiskConfig, { sessionId });

    expect(risk.maxPositionUsd).toBe(1500);
    expect(risk.stopLossPct).toBe(2.5);
  });

  it("strategy:save-research-posture and get-research-posture round-trip", async () => {
    await invokeIpc(channels.strategy.saveResearchPosture, {
      sessionId,
      researchPosture: {
        postureNotes: "Focus on 8-K catalysts",
      },
    });

    const posture = await invokeIpc<{ postureNotes: string }>(
      channels.strategy.getResearchPosture,
      { sessionId },
    );

    expect(posture.postureNotes).toBe("Focus on 8-K catalysts");
  });

  it("strategy:save-risk-config rejects invalid payloads", async () => {
    const error = await invokeIpcError(channels.strategy.saveRiskConfig, {
      sessionId: "",
      riskConfig: { maxPositionUsd: -1 },
    });

    expect(error.message.length).toBeGreaterThan(0);
  });
});
