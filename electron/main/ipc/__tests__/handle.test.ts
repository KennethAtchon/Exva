import "./ipc-electron-mock";
import { beforeEach, describe, expect, it } from "vitest";
import { ipcMain } from "electron";
import { z } from "zod";
import { AppError } from "@electron/shared/infra/errors";
import { payloadMeta } from "../../services/infra/log-safety";
import { handle } from "../handle";
import { ipcNoPayloadSchema } from "../payload-schemas";
import {
  createIpcInvokeEvent,
  ipcHarness,
  resetIpcHandlers,
} from "./ipc-test-harness";

describe("ipc handle()", () => {
  beforeEach(() => {
    resetIpcHandlers();
  });

  it("rejects IPC from a non-owned webContents", async () => {
    handle(ipcMain, "test:untrusted-window", ipcNoPayloadSchema, async () => ({
      ok: true,
    }));
    const registered = ipcHarness.handlers.get("test:untrusted-window");
    expect(registered).toBeDefined();
    if (!registered) return;

    ipcHarness.windows = [];
    await expect(
      registered(createIpcInvokeEvent({ trusted: false }), {}),
    ).rejects.toThrow("Untrusted IPC sender");
  });

  it("rejects IPC from a sub-frame sender", async () => {
    handle(ipcMain, "test:sub-frame", ipcNoPayloadSchema, async () => ({
      ok: true,
    }));
    const registered = ipcHarness.handlers.get("test:sub-frame");
    expect(registered).toBeDefined();
    if (!registered) return;

    await expect(
      registered(createIpcInvokeEvent({ subFrame: true }), {}),
    ).rejects.toThrow("Untrusted IPC sender");
  });

  it("allows IPC from an owned main-frame sender", async () => {
    handle(
      ipcMain,
      "test:trusted",
      z.object({ sessionId: z.string() }),
      async () => ({ ok: true }),
    );
    const registered = ipcHarness.handlers.get("test:trusted");
    expect(registered).toBeDefined();
    if (!registered) return;

    ipcHarness.windows = [ipcHarness.mockBrowserWindow];
    await expect(
      registered(createIpcInvokeEvent(), { sessionId: "s1" }),
    ).resolves.toEqual({ ok: true });
  });

  it("rejects invalid payloads with INVALID_PAYLOAD", async () => {
    handle(
      ipcMain,
      "test:invalid-payload",
      z.object({ sessionId: z.string().min(1) }),
      async () => ({ ok: true }),
    );
    const registered = ipcHarness.handlers.get("test:invalid-payload");
    expect(registered).toBeDefined();
    if (!registered) return;

    const error = await registered(createIpcInvokeEvent(), {}).catch(
      (err: unknown) => err,
    );
    expect((error as Error).message).toBe("Invalid IPC payload");
    expect((error as Error & { code?: string }).code).toBe("INVALID_PAYLOAD");
  });

  it("maps handler errors via toIpcError without leaking stack paths", async () => {
    handle(ipcMain, "test:app-error", ipcNoPayloadSchema, async () => {
      throw new AppError("Invalid session mode", "VALIDATION_FAILED", {
        mode: "live_allowed",
      });
    });

    const registered = ipcHarness.handlers.get("test:app-error");
    expect(registered).toBeDefined();
    if (!registered) return;

    const error = await registered(createIpcInvokeEvent(), undefined).catch(
      (err: unknown) => err,
    );

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("Invalid session mode");
    expect((error as Error & { code?: string }).code).toBe("VALIDATION_FAILED");
    expect((error as Error).message).not.toContain("at Object");
    expect((error as Error).message).not.toContain(".ts:");
  });

  it("maps generic errors to safe IPC messages", async () => {
    handle(ipcMain, "test:internal-error", ipcNoPayloadSchema, async () => {
      const err = new Error("database exploded");
      err.stack =
        "Error: database exploded\n    at secretFn (/var/app/internal/db.ts:99:11)";
      throw err;
    });

    const registered = ipcHarness.handlers.get("test:internal-error");
    expect(registered).toBeDefined();
    if (!registered) return;

    const error = await registered(createIpcInvokeEvent(), undefined).catch(
      (err: unknown) => err,
    );

    expect((error as Error).message).toBe("database exploded");
    expect((error as Error).message).not.toContain("/var/app/internal");
    expect((error as Error & { code?: string }).code).toBe("UNKNOWN");
  });

  it("flags sensitive payload keys for IPC debug logging", () => {
    const meta = payloadMeta({
      sessionId: "s1",
      apiKey: "sk-secret",
      nested: { password: "hunter2" },
    });

    expect(meta.sensitiveKeyDetected).toBe(true);
    expect(meta.sensitiveKeyCount).toBe(2);
    expect(meta.sizeBytes).toBeGreaterThan(0);
  });
});
