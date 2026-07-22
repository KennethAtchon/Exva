import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { channels } from "@electron/shared/ipc/channels";
import { agentMessages } from "../../db/schema";
import { createMinimalSession, insertAgentRun } from "../../db/test-fixtures";
import {
  getRuntimeLogLevel,
  resetRuntimeLogLevel,
} from "../../services/infra/log";
import {
  createIpcTestServices,
  invokeIpc,
  invokeIpcError,
  registerIpcTestHandlers,
  type IpcTestContext,
} from "./ipc-test-harness";

describe("developer IPC", () => {
  let ctx: IpcTestContext;
  let tmpHome: string;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "exva-developer-ipc-"));
    vi.spyOn(os, "homedir").mockReturnValue(tmpHome);
    ctx = createIpcTestServices();
    registerIpcTestHandlers(ctx.services);
  });

  afterEach(() => {
    resetRuntimeLogLevel();
    ctx.cleanup();
    vi.restoreAllMocks();
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it("applies and stops the persisted global runtime log override", async () => {
    const result = await invokeIpc<{
      overrideId: string;
      effectiveLogLevel: string;
    }>(channels.developer.setLogLevel, {
      scopeType: "global",
      mainLogLevel: "debug",
      untilStopped: true,
    });

    expect(result.effectiveLogLevel).toBe("debug");
    expect(getRuntimeLogLevel()).toBe("debug");

    const settings = await invokeIpc<{
      activeOverrides: Array<{ id: string }>;
    }>(channels.developer.getSettings);
    expect(settings.activeOverrides).toEqual([
      expect.objectContaining({ id: result.overrideId }),
    ]);

    const stopped = await invokeIpc<{ effectiveLogLevel: string }>(
      channels.developer.stopLogOverride,
      { overrideId: result.overrideId },
    );

    expect(stopped.effectiveLogLevel).toBe(getRuntimeLogLevel());
    expect(getRuntimeLogLevel()).not.toBe("debug");
  });

  it("exports a time-bounded, session-scoped, redacted bundle", async () => {
    const includedSession = createMinimalSession(ctx.db, {
      name: "Included",
    });
    const excludedSession = createMinimalSession(ctx.db, {
      name: "Excluded",
    });
    const recent = new Date().toISOString();
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

    ctx.services.repos.events.insert({
      id: "included-event",
      session_id: includedSession.id,
      trade_id: null,
      cycle_id: null,
      level: "ERROR",
      agent_type: "orchestrator",
      message: "authorization=Bearer secret-value",
      created_at: recent,
    });
    ctx.services.repos.events.insert({
      id: "old-event",
      session_id: includedSession.id,
      trade_id: null,
      cycle_id: null,
      level: "INFO",
      agent_type: "orchestrator",
      message: "outside window",
      created_at: old,
    });
    ctx.services.repos.events.insert({
      id: "other-session-event",
      session_id: excludedSession.id,
      trade_id: null,
      cycle_id: null,
      level: "INFO",
      agent_type: "orchestrator",
      message: "wrong session",
      created_at: recent,
    });
    insertAgentRun(ctx.db, {
      id: "included-run",
      session_id: includedSession.id,
      output_text: "sensitive model output",
      created_at: recent,
    });
    ctx.db.db
      .insert(agentMessages)
      .values({
        id: "included-message",
        agentRunId: "included-run",
        sessionId: includedSession.id,
        role: "assistant",
        providerKey: "provider",
        modelId: "model",
        messagesJson: JSON.stringify({ prompt: "private prompt" }),
        toolCallsJson: JSON.stringify({ apiKey: "secret-api-key" }),
        strategySnapshotJson: "{}",
        createdAt: recent,
      })
      .run();

    const result = await invokeIpc<{ path: string; sizeBytes: number }>(
      channels.developer.exportDebugBundle,
      {
        scope: { type: "session", id: includedSession.id },
        includePrompts: true,
        includeToolPayloads: true,
        timeWindowMinutes: 60,
      },
    );
    const raw = fs.readFileSync(result.path, "utf8");
    const bundle = JSON.parse(raw) as {
      outcome: string;
      manifest: { scopeCoverage: { fullySupported: boolean } };
      events: Array<{ id: string }>;
      agentRuns: Array<Record<string, unknown>>;
      agentMessages: Array<{
        messages: { prompt: string };
        toolCalls: { apiKey: string };
      }>;
    };

    expect(result.path.startsWith(path.join(tmpHome, ".exva"))).toBe(true);
    expect(result.sizeBytes).toBe(Buffer.byteLength(raw, "utf8"));
    expect(bundle.outcome).toBe("ok");
    expect(bundle.manifest.scopeCoverage.fullySupported).toBe(true);
    expect(bundle.events.map((row: { id: string }) => row.id)).toEqual([
      "included-event",
    ]);
    expect(bundle.agentRuns).toHaveLength(1);
    expect(bundle.agentRuns[0]).not.toHaveProperty("outputText");
    expect(bundle.agentMessages[0].messages.prompt).toBe("private prompt");
    expect(bundle.agentMessages[0].toolCalls.apiKey).toBe("[REDACTED]");
    expect(raw).not.toContain("secret-api-key");
    expect(raw).not.toContain("secret-value");
    expect(raw).not.toContain("sensitive model output");
  });

  it("rejects malformed bundle requests at the IPC boundary", async () => {
    const error = await invokeIpcError(channels.developer.exportDebugBundle, {
      scope: { type: "session" },
      includePrompts: false,
      includeToolPayloads: false,
      timeWindowMinutes: 0,
    });

    expect(error.code).toBe("INVALID_PAYLOAD");
  });
});
