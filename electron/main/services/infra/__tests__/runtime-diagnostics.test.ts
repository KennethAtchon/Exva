import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb } from "../../../db/test-helpers";
import { EventsRepo } from "../../../db/repositories/system/events-repo";
import type { AppServices } from "../../app-services";
import { getBootId } from "../telemetry-context";
import {
  recordRuntimeDiagnostic,
  sanitizeDiagnosticText,
} from "../runtime-diagnostics";

describe("runtime diagnostics", () => {
  let db: ReturnType<typeof createTestDb>;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.sqlite.close();
  });

  it("redacts common secret text and local file URLs", () => {
    const sanitized = sanitizeDiagnosticText(
      "Bearer bearer-value Basic basic-value sk-secret ghp_secret " +
        "github_pat_secret xoxb-secret api_key=api-value secret:secret-value " +
        "token=token-value password=password-value authorization=auth-value " +
        "at file:///Users/ken/Exva/private.ts:12",
    );

    expect(sanitized).not.toMatch(
      /bearer-value|basic-value|sk-secret|ghp_secret|github_pat_secret|xoxb-secret|api-value|secret-value|token-value|password-value|auth-value|\/Users\/ken/,
    );
    expect(sanitized).toContain("Bearer [REDACTED]");
    expect(sanitized).toContain("api_key=[REDACTED]");
    expect(sanitized).toContain("<app-file>");
  });

  it("durably inserts the supplied incident ID with a safe summary", () => {
    const events = new EventsRepo(db);
    const services = { repos: { events } } as unknown as AppServices;
    const eventId = "18434342-4004-4b4d-9868-3c99459e17a8";

    const returnedId = recordRuntimeDiagnostic({
      kind: "renderer_error",
      eventId,
      services,
      severity: "CRITICAL",
      detail: {
        message: "authorization=top-secret",
        apiKey: "sk-persisted-secret",
      },
    });

    const persisted = events.query().find((event) => event.id === eventId);
    expect(returnedId).toBe(eventId);
    expect(persisted).toEqual(
      expect.objectContaining({
        id: eventId,
        level: "CRITICAL",
        session_id: null,
        message: `Runtime diagnostic renderer_error incident=${eventId} boot=${getBootId()}`,
      }),
    );
    expect(persisted?.message).not.toMatch(/top-secret|sk-persisted-secret/);
  });

  it("returns the incident ID when persistence fails", () => {
    const insert = vi.fn(() => {
      throw new Error("database unavailable");
    });
    const services = {
      repos: { events: { insert } },
    } as unknown as AppServices;
    const eventId = "593230a3-51c6-489f-962c-fd9208ddd7a2";

    expect(
      recordRuntimeDiagnostic({
        kind: "window_unresponsive",
        eventId,
        services,
        detail: { reason: "hung" },
      }),
    ).toBe(eventId);
    expect(insert).toHaveBeenCalledOnce();
  });
});
