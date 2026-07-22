import "./ipc-electron-mock";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { channels } from "@electron/shared/ipc/channels";
import { registerDiagnosticsHandlers } from "../system/diagnostics";
import {
  createIpcTestServices,
  invokeIpc,
  resetIpcHandlers,
  type IpcTestContext,
} from "./ipc-test-harness";

describe("diagnostics IPC", () => {
  let ctx: IpcTestContext;

  beforeEach(() => {
    ctx = createIpcTestServices();
    resetIpcHandlers();
    registerDiagnosticsHandlers(ctx.services);
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it.each([
    ["error", "renderer_error"],
    ["unhandled_rejection", "renderer_unhandled_rejection"],
    ["react_error_boundary", "react_error_boundary"],
    ["bootstrap_error", "renderer_bootstrap_error"],
  ] as const)(
    "maps and persists %s diagnostics",
    async (rendererKind, runtimeKind) => {
      const eventId = crypto.randomUUID();

      const result = await invokeIpc<{ recorded: true; eventId: string }>(
        channels.diagnostics.reportRendererError,
        {
          kind: rendererKind,
          eventId,
          occurredAt: "2026-07-21T12:00:00.000Z",
          message: "token=renderer-secret",
        },
      );

      const persisted = ctx.services.repos.events
        .query()
        .find((event) => event.id === eventId);
      expect(result).toEqual({ recorded: true, eventId });
      expect(persisted?.message).toContain(
        `Runtime diagnostic ${runtimeKind} incident=${eventId}`,
      );
      expect(persisted?.message).not.toContain("renderer-secret");
    },
  );
});
