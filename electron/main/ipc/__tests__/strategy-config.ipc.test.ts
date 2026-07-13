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

describe("strategyConfig IPC handlers", () => {
  let db = createTestDb();
  let harness = createIpcTestServices(db);
  let sessionId = "";

  beforeEach(() => {
    db = createTestDb();
    harness = createIpcTestServices(db);
    resetIpcHandlers();
    registerPhase4IpcHandlers(harness.services);
    sessionId = createMinimalSession(db).id;
    harness.services.repos.session.setFocus(sessionId);
  });

  afterEach(() => {
    harness.cleanup();
    resetIpcHandlers();
  });

  it("strategyConfig:get returns versioned doc", async () => {
    const record = await invokeIpc<{
      version: number;
      doc: { risk: { maxPositionUsd: number } };
    }>(channels.strategyConfig.get, { sessionId });
    expect(record.version).toBe(1);
    expect(record.doc.risk.maxPositionUsd).toBeGreaterThan(0);
  });

  it("strategyConfig:update round-trips and bumps version", async () => {
    const before = await invokeIpc<{ version: number }>(
      channels.strategyConfig.get,
      { sessionId },
    );
    const after = await invokeIpc<{
      version: number;
      doc: { risk: { maxPositionUsd: number } };
    }>(channels.strategyConfig.update, {
      sessionId,
      expectedVersion: before.version,
      patch: { risk: { maxPositionUsd: 777 } },
    });
    expect(after.version).toBe(before.version + 1);
    expect(after.doc.risk.maxPositionUsd).toBe(777);
  });

  it("strategyConfig:update rejects stale version", async () => {
    const before = await invokeIpc<{ version: number }>(
      channels.strategyConfig.get,
      { sessionId },
    );
    await invokeIpc(channels.strategyConfig.update, {
      sessionId,
      expectedVersion: before.version,
      patch: { risk: { maxPositionUsd: 1 } },
    });
    const error = await invokeIpcError(channels.strategyConfig.update, {
      sessionId,
      expectedVersion: before.version,
      patch: { risk: { maxPositionUsd: 2 } },
    });
    expect(error.code).toBe("STALE_VERSION");
  });

  it("strategyConfig:history and rollback", async () => {
    const before = await invokeIpc<{
      version: number;
      doc: { risk: { maxPositionUsd: number } };
    }>(channels.strategyConfig.get, { sessionId });
    const original = before.doc.risk.maxPositionUsd;

    const mid = await invokeIpc<{ version: number }>(
      channels.strategyConfig.update,
      {
        sessionId,
        expectedVersion: before.version,
        patch: { risk: { maxPositionUsd: 4242 } },
      },
    );

    const { history } = await invokeIpc<{
      history: Array<{ version: number }>;
    }>(channels.strategyConfig.history, { sessionId });
    expect(history.length).toBeGreaterThanOrEqual(1);

    const rolled = await invokeIpc<{
      doc: { risk: { maxPositionUsd: number } };
    }>(channels.strategyConfig.rollback, {
      sessionId,
      version: before.version,
      expectedVersion: mid.version,
    });
    expect(rolled.doc.risk.maxPositionUsd).toBe(original);
  });
});
