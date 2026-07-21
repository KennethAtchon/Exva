import { describe, expect, it } from "vitest";
import { createTestDb } from "../../../../db/test-helpers";
import { SignalSourcesRepo } from "../signal-sources-repo";
import { SignalSourceRuntimeRepo } from "../signal-source-runtime-repo";

describe("SignalSourceRuntimeRepo", () => {
  it("persists poll success and history so quiet feeds stay durable", () => {
    const db = createTestDb();
    const sources = new SignalSourcesRepo(db);
    const runtime = new SignalSourceRuntimeRepo(db);
    sources.create({
      id: "source/edgar_8k",
      type: "edgar_8k",
      name: "EDGAR",
      description: null,
      enabled: true,
      configJson: "{}",
    });

    const state = runtime.recordPoll({
      sourceId: "source/edgar_8k",
      polledAt: "2026-07-20T17:00:00.000Z",
      outcome: "success",
      httpStatus: 200,
      result: { detected: 12, passed: 0, dropped: 12, errors: [] },
      status: "running",
      lastError: null,
      durationMs: 42,
    });

    expect(state).toMatchObject({
      sourceId: "source/edgar_8k",
      status: "running",
      lastSuccessAt: "2026-07-20T17:00:00.000Z",
      consecutiveFailures: 0,
      detected: 12,
      passed: 0,
      dropped: 12,
      lastOutcome: "success",
      httpStatus: 200,
    });
    expect(runtime.listPolls("source/edgar_8k")).toHaveLength(1);
    db.sqlite.close();
  });

  it("increments consecutive failures on http errors", () => {
    const db = createTestDb();
    const sources = new SignalSourcesRepo(db);
    const runtime = new SignalSourceRuntimeRepo(db);
    sources.create({
      id: "source/prediction_event",
      type: "prediction_event",
      name: "Prediction",
      description: null,
      enabled: true,
      configJson: "{}",
    });

    runtime.recordPoll({
      sourceId: "source/prediction_event",
      polledAt: "2026-07-20T17:00:00.000Z",
      outcome: "success",
      httpStatus: 200,
      result: { detected: 0, passed: 0, dropped: 0, errors: [] },
      status: "running",
      lastError: null,
      durationMs: 10,
    });
    const failed = runtime.recordPoll({
      sourceId: "source/prediction_event",
      polledAt: "2026-07-20T17:15:00.000Z",
      outcome: "http_error",
      httpStatus: 503,
      result: {
        detected: 0,
        passed: 0,
        dropped: 0,
        errors: ["Gamma markets status 503"],
      },
      status: "error",
      lastError: "Gamma markets status 503",
      durationMs: 8,
    });

    expect(failed.consecutiveFailures).toBe(1);
    expect(failed.lastSuccessAt).toBe("2026-07-20T17:00:00.000Z");
    expect(failed.status).toBe("error");
    expect(runtime.listPolls("source/prediction_event")).toHaveLength(2);
    db.sqlite.close();
  });
});
