import { afterEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@electron/shared/infra/errors";
import type { SessionExecutionStepsRepo } from "../../../../db/repositories/sessions/session-execution-steps-repo";
import { EventBus } from "../../../infra/event-bus";
import { TradingStepRunner } from "../trading-step-runner";

describe("TradingStepRunner", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("wraps fn, writes running to succeeded, and emits step lifecycle events", async () => {
    const { runner, repo, bus, sessionId } = createHarness();
    const started = vi.fn();
    const succeeded = vi.fn();
    bus.on("step:started", started);
    bus.on("step:succeeded", succeeded);

    const result = await runner.run("selector", async () => ["AAPL"]);

    expect(result).toEqual({ ok: true, value: ["AAPL"] });
    expect(repo.get(sessionId, "cycle-1", "selector")).toMatchObject({
      status: "succeeded",
      attempt: 1,
      retryable: false,
    });
    expect(started).toHaveBeenCalledWith(
      expect.objectContaining({ stage: "selector", attempt: 1 }),
    );
    expect(succeeded).toHaveBeenCalledWith(
      expect.objectContaining({ stage: "selector" }),
    );
  });

  it("marks provider-style failures as retrying with nextRetryAt", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const { runner, repo, sessionId } = createHarness();

    const result = await runner.run("selector", async () => {
      const error = new Error("provider unavailable") as Error & {
        statusCode: number;
      };
      error.statusCode = 503;
      throw error;
    });

    expect(result).toEqual({
      ok: false,
      retryable: true,
      errorCode: "HTTP_503",
      errorMessage: "provider unavailable",
      outcome: "transient",
      level: "WARN",
      reasonCategory: "provider_transient",
    });
    expect(repo.get(sessionId, "cycle-1", "selector")).toMatchObject({
      status: "retrying",
      attempt: 1,
      retryable: true,
    });
    expect(
      repo.get(sessionId, "cycle-1", "selector")?.nextRetryAt,
    ).toBeTruthy();
    runner.dispose();
  });

  it("marks VALIDATION_FAILED as failed without retry", async () => {
    const { runner, repo, sessionId } = createHarness();

    const result = await runner.run("decision", async () => {
      throw new AppError("bad decision", "VALIDATION_FAILED");
    });

    expect(result).toEqual({
      ok: false,
      retryable: false,
      errorCode: "VALIDATION_FAILED",
      errorMessage: "bad decision",
      outcome: "transient",
      level: "ERROR",
      reasonCategory: "unexpected_bug",
    });
    expect(repo.get(sessionId, "cycle-1", "decision")).toMatchObject({
      status: "failed",
      retryable: false,
      attempt: 1,
    });
  });

  it("retries provider errors that were wrapped as retryable AppErrors", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const { runner, repo, sessionId } = createHarness();

    const result = await runner.run("selector", async () => {
      throw new AppError(
        "Provider unreachable: Failed after 3 attempts. Last error: Provider returned error",
        "PROVIDER_UNREACHABLE",
        {
          retryable: true,
          status: 503,
          rawMessage:
            "Failed after 3 attempts. Last error: Provider returned error",
        },
      );
    });

    expect(result).toEqual({
      ok: false,
      retryable: true,
      errorCode: "PROVIDER_UNREACHABLE",
      errorMessage:
        "Provider unreachable: Failed after 3 attempts. Last error: Provider returned error",
      outcome: "transient",
      level: "WARN",
      reasonCategory: "provider_transient",
    });
    expect(repo.get(sessionId, "cycle-1", "selector")).toMatchObject({
      status: "retrying",
      attempt: 1,
      retryable: true,
    });
  });

  it("caps retryable failures after four backoff retries", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const { runner, repo, sessionId } = createHarness();
    const failingFn = async () => {
      const error = new Error("timeout") as Error & { statusCode: number };
      error.statusCode = 503;
      throw error;
    };

    await runner.run("broker_order", failingFn);
    await runner.run("broker_order", failingFn);
    await runner.run("broker_order", failingFn);
    await runner.run("broker_order", failingFn);
    const result = await runner.run("broker_order", failingFn);

    expect(result).toEqual({
      ok: false,
      retryable: false,
      errorCode: "HTTP_503",
      errorMessage: "timeout",
      outcome: "transient",
      level: "ERROR",
      reasonCategory: "provider_transient",
    });
    expect(repo.get(sessionId, "cycle-1", "broker_order")).toMatchObject({
      status: "failed",
      retryable: false,
      attempt: 5,
    });
  });

  it("uses exponential step backoff across four retries", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-16T00:00:00.000Z"));
    vi.spyOn(Math, "random").mockReturnValue(0);
    const { runner, repo, sessionId } = createHarness();

    const failingFn = async () => {
      const error = new Error("provider unavailable") as Error & {
        statusCode: number;
      };
      error.statusCode = 503;
      throw error;
    };

    await runner.run("selector", failingFn);
    expect(
      Date.parse(
        repo.get(sessionId, "cycle-1", "selector")?.nextRetryAt ?? "",
      ) - Date.now(),
    ).toBe(30_000);

    await runner.run("selector", failingFn);
    expect(
      Date.parse(
        repo.get(sessionId, "cycle-1", "selector")?.nextRetryAt ?? "",
      ) - Date.now(),
    ).toBe(60_000);

    await runner.run("selector", failingFn);
    expect(
      Date.parse(
        repo.get(sessionId, "cycle-1", "selector")?.nextRetryAt ?? "",
      ) - Date.now(),
    ).toBe(120_000);

    await runner.run("selector", failingFn);
    expect(
      Date.parse(
        repo.get(sessionId, "cycle-1", "selector")?.nextRetryAt ?? "",
      ) - Date.now(),
    ).toBe(240_000);
  });

  it("skips fn when the step already succeeded and skipIfPreviouslySucceeded is enabled", async () => {
    const { runner, repo, sessionId } = createHarness();
    repo.upsert({
      sessionId,
      cycleId: "cycle-1",
      stage: "review",
      status: "succeeded",
      attempt: 1,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      nextRetryAt: null,
      lastErrorCode: null,
      lastErrorMessage: null,
      outcome: null,
      retryable: false,
    });
    const fn = vi.fn(async () => "should not run");

    const result = await runner.run("review", fn, {
      skipIfPreviouslySucceeded: true,
    });

    expect(result.ok).toBe(true);
    expect(fn).not.toHaveBeenCalled();
    expect(repo.get(sessionId, "cycle-1", "review")).toMatchObject({
      status: "succeeded",
      attempt: 1,
    });
  });
});

function createHarness() {
  const bus = new EventBus();
  const repo = createMemoryRepo();
  const sessionId = "session-1";
  const runner = new TradingStepRunner(sessionId, "cycle-1", {
    stepsRepo: repo,
    bus,
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as never,
  });

  return { runner, repo, bus, sessionId };
}

function createMemoryRepo(): SessionExecutionStepsRepo {
  type Row = ReturnType<SessionExecutionStepsRepo["get"]> & object;
  const rows = new Map<string, Row>();
  return {
    upsert(step) {
      const key = `${step.sessionId}:${step.cycleId}:${step.stage}`;
      const existing = rows.get(key);
      const next = {
        id: existing?.id ?? crypto.randomUUID(),
        createdAt: existing?.createdAt ?? new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ...step,
      } as Row;
      rows.set(key, next);
      return next;
    },
    get(sessionId, cycleId, stage) {
      return rows.get(`${sessionId}:${cycleId}:${stage}`) ?? null;
    },
    getLatestByCycle(sessionId, cycleId) {
      return [...rows.values()].filter(
        (row) => row.sessionId === sessionId && row.cycleId === cycleId,
      );
    },
    getLatestBySession(sessionId) {
      return [...rows.values()].filter((row) => row.sessionId === sessionId);
    },
    getLatestCycleState(sessionId) {
      const all = [...rows.values()].filter(
        (row) => row.sessionId === sessionId,
      );
      const sorted = all.sort((a, b) =>
        String(b.updatedAt).localeCompare(String(a.updatedAt)),
      );
      const cycleId = sorted[0]?.cycleId ?? null;
      if (!cycleId) return { cycleId: null, steps: [] };
      return { cycleId, steps: sorted.filter((r) => r.cycleId === cycleId) };
    },
    clearFailed(sessionId, cycleId, stage) {
      rows.delete(`${sessionId}:${cycleId}:${stage}`);
    },
  };
}
