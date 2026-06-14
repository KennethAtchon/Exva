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

describe("session IPC handlers", () => {
  let db = createTestDb();
  let harness = createIpcTestServices(db);

  beforeEach(() => {
    db = createTestDb();
    harness = createIpcTestServices(db);
    resetIpcHandlers();
    registerPhase4IpcHandlers(harness.services);
    harness.insertBroker({ id: "broker-paper" });
    harness.configureAiProvider();
  });

  afterEach(() => {
    harness.cleanup();
    resetIpcHandlers();
  });

  it("session:list returns sessions scoped to the workspace environment", async () => {
    const paper = createMinimalSession(db, {
      name: "Paper Session",
      executionMode: "paper_only",
    });
    createMinimalSession(db, {
      name: "Live Session",
      executionMode: "live_allowed",
    });

    const result = await invokeIpc<{
      sessions: Array<{ id: string; name: string }>;
    }>(channels.session.list, {});

    expect(result.sessions.map((session) => session.id)).toEqual([paper.id]);
  });

  it("session:create persists a valid session", async () => {
    const created = await invokeIpc<{ id: string; status: string }>(
      channels.session.create,
      harness.validSessionCreatePayload("broker-paper"),
    );

    expect(created.status).toBe("draft");
    expect(harness.services.repos.session.requireById(created.id).name).toBe(
      "IPC Test Session",
    );
  });

  it("session:create rejects execution mode mismatch with VALIDATION_FAILED", async () => {
    harness.services.repos.workspacePreferences.update({
      globalEnvironmentMode: "live",
    });

    const error = await invokeIpcError(
      channels.session.create,
      harness.validSessionCreatePayload("broker-paper", {
        executionMode: "paper_only",
      }),
    );

    expect(error.code).toBe("VALIDATION_FAILED");
    expect(error.message).toContain("live_allowed");
  });

  it("session:create rejects invalid payloads", async () => {
    const error = await invokeIpcError(channels.session.create, {
      name: "",
      objective: "missing required fields",
    });

    expect(error.message.length).toBeGreaterThan(0);
  });

  it("session:update mutates an existing session", async () => {
    const created = await invokeIpc<{ id: string }>(
      channels.session.create,
      harness.validSessionCreatePayload("broker-paper"),
    );

    await invokeIpc(channels.session.update, {
      id: created.id,
      input: {
        name: "Renamed Session",
        objective: "Updated objective for NVDA",
        selectionMode: "manual_shortlist",
        instrumentClasses: ["stock"],
        instrumentScope: "NVDA",
        selectorSettings: { aiPickerEnabled: false },
        executionMode: "paper_only",
        brokerAssignments: [
          { brokerAccountId: "broker-paper", allocatedUsd: 6000 },
        ],
        brokerOverridesByInstrumentClass: { stock: "broker-paper" },
      },
    });

    expect(harness.services.repos.session.requireById(created.id).name).toBe(
      "Renamed Session",
    );
  });

  it("session:update rejects execution mode mismatch with VALIDATION_FAILED", async () => {
    const created = await invokeIpc<{ id: string }>(
      channels.session.create,
      harness.validSessionCreatePayload("broker-paper"),
    );
    harness.services.repos.workspacePreferences.update({
      globalEnvironmentMode: "live",
    });
    harness.insertBroker({ id: "broker-live", mode: "live" });

    const error = await invokeIpcError(channels.session.update, {
      id: created.id,
      input: {
        name: "Live Attempt",
        objective: "Should fail in paper workspace mismatch",
        selectionMode: "manual_shortlist",
        instrumentClasses: ["stock"],
        instrumentScope: "AAPL",
        selectorSettings: { aiPickerEnabled: false },
        executionMode: "paper_only",
        brokerAssignments: [
          { brokerAccountId: "broker-live", allocatedUsd: 5000 },
        ],
      },
    });

    expect(error.code).toBe("VALIDATION_FAILED");
  });

  it("session:get-status returns idle when nothing is focused", async () => {
    createMinimalSession(db);

    await expect(invokeIpc(channels.session.getStatus)).resolves.toBe("idle");
  });

  it("session:get-status returns status for the focused session", async () => {
    const session = createMinimalSession(db);
    harness.services.repos.session.setFocus(session.id);

    await expect(invokeIpc(channels.session.getStatus)).resolves.toBe("draft");
  });

  it("session:archive archives a stopped session", async () => {
    const session = createMinimalSession(db);

    const result = await invokeIpc<{ archived: boolean }>(
      channels.session.archive,
      { id: session.id },
    );

    expect(result.archived).toBe(true);
    expect(harness.services.repos.session.requireById(session.id).status).toBe(
      "archived",
    );
  });

  it("session:archive rejects active sessions", async () => {
    const session = createMinimalSession(db);
    harness.services.repos.session.setStatus("active", session.id);

    const error = await invokeIpcError(channels.session.archive, {
      id: session.id,
    });

    expect(error.code).toBe("INVALID_TRANSITION");
  });

  it("session:duplicate clones a session in the same environment", async () => {
    const source = createMinimalSession(db, { name: "Source Session" });

    const duplicated = await invokeIpc<{ id: string; status: string }>(
      channels.session.duplicate,
      { sourceId: source.id, name: "Cloned Session" },
    );

    expect(duplicated.status).toBe("draft");
    expect(harness.services.repos.session.requireById(duplicated.id).name).toBe(
      "Cloned Session",
    );
  });

  it("session:duplicate rejects invalid payloads", async () => {
    const error = await invokeIpcError(channels.session.duplicate, {
      sourceId: "",
      name: "",
    });

    expect(error.message.length).toBeGreaterThan(0);
  });
});
