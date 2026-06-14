import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppError } from "@electron/shared/infra/errors";
import { createMinimalSession } from "../../db/test-fixtures";
import {
  assertBrokerModeMatchesWorkspace,
  assertExecutionModeMatchesWorkspace,
  assertFocusedSessionMatchesWorkspace,
  assertSessionInWorkspaceEnvironment,
  clearFocusIfEnvironmentMismatch,
  workspaceEnvironmentSessionIds,
} from "../environment-guards";
import { createIpcTestServices, type IpcTestContext } from "./ipc-test-harness";

describe("environment-guards", () => {
  let ctx: IpcTestContext;

  beforeEach(() => {
    ctx = createIpcTestServices();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it("clearFocusIfEnvironmentMismatch unfocuses when session mode differs from workspace", () => {
    const paperSession = createMinimalSession(ctx.db, {
      executionMode: "paper_only",
    });
    ctx.services.repos.session.setFocus(paperSession.id);
    ctx.services.repos.workspacePreferences.update({
      globalEnvironmentMode: "live",
    });

    clearFocusIfEnvironmentMismatch(ctx.services);

    expect(ctx.services.repos.session.getFocused()).toBeNull();
  });

  it("clearFocusIfEnvironmentMismatch keeps focus when session matches workspace", () => {
    const paperSession = createMinimalSession(ctx.db, {
      executionMode: "paper_only",
    });
    ctx.services.repos.session.setFocus(paperSession.id);

    clearFocusIfEnvironmentMismatch(ctx.services);

    expect(ctx.services.repos.session.getFocused()?.id).toBe(paperSession.id);
  });

  it("assertExecutionModeMatchesWorkspace rejects live session in paper workspace", () => {
    expect(() =>
      assertExecutionModeMatchesWorkspace(ctx.services, "live_allowed"),
    ).toThrow(AppError);
    expect(() =>
      assertExecutionModeMatchesWorkspace(ctx.services, "live_allowed"),
    ).toThrow(/must be paper_only while workspace is in paper mode/);
  });

  it("assertExecutionModeMatchesWorkspace rejects paper session in live workspace", () => {
    ctx.services.repos.workspacePreferences.update({
      globalEnvironmentMode: "live",
    });

    expect(() =>
      assertExecutionModeMatchesWorkspace(ctx.services, "paper_only"),
    ).toThrow(/must be live_allowed while workspace is in live mode/);
  });

  it("assertBrokerModeMatchesWorkspace rejects mismatched broker mode", () => {
    expect(() =>
      assertBrokerModeMatchesWorkspace(ctx.services, "live"),
    ).toThrow(/Broker mode must be paper/);
  });

  it("assertFocusedSessionMatchesWorkspace returns focused session id when aligned", () => {
    const session = createMinimalSession(ctx.db, {
      executionMode: "paper_only",
    });
    ctx.services.repos.session.setFocus(session.id);

    expect(assertFocusedSessionMatchesWorkspace(ctx.services)).toBe(session.id);
  });

  it("assertFocusedSessionMatchesWorkspace rejects focused live session in paper workspace", () => {
    const liveSession = createMinimalSession(ctx.db, {
      executionMode: "live_allowed",
      name: "Live Alpha",
    });
    ctx.services.repos.session.setFocus(liveSession.id);

    expect(() => assertFocusedSessionMatchesWorkspace(ctx.services)).toThrow(
      /does not match the paper workspace environment/,
    );
  });

  it("assertSessionInWorkspaceEnvironment rejects cross-environment session access", () => {
    const liveSession = createMinimalSession(ctx.db, {
      executionMode: "live_allowed",
      name: "Live Beta",
    });

    expect(() =>
      assertSessionInWorkspaceEnvironment(ctx.services, liveSession.id),
    ).toThrow(/not in the current paper workspace environment/);
  });

  it("workspaceEnvironmentSessionIds lists only sessions matching workspace mode", () => {
    const paperA = createMinimalSession(ctx.db, {
      name: "Paper A",
      executionMode: "paper_only",
    });
    const paperB = createMinimalSession(ctx.db, {
      name: "Paper B",
      executionMode: "paper_only",
    });
    const liveSession = createMinimalSession(ctx.db, {
      name: "Live One",
      executionMode: "live_allowed",
    });

    const ids = workspaceEnvironmentSessionIds(ctx.services);

    expect(ids).toContain(paperA.id);
    expect(ids).toContain(paperB.id);
    expect(ids).not.toContain(liveSession.id);
  });
});
