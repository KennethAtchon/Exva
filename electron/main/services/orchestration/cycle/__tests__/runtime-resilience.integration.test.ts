import { describe, expect, it, vi } from "vitest";
import { AppError } from "@electron/shared/infra/errors";
import { assertSessionDataSpendAvailable } from "../../../tools/data-spend-guard";
import { TradingCycleContext } from "../trading-cycle-context";
import { classifyRiskGateRejection } from "../../policy/outcome-classifier";

describe("runtime resilience integration", () => {
  it("routes spend guardrails to attention_required without auto-retry", () => {
    const ctx = createContext();
    const spendError = classifyRiskGateRejection({ gateType: "api_budget" });

    ctx.handleStepFailure("risk_gate", "cycle-1", {
      ok: false,
      retryable: false,
      errorCode: (spendError as AppError).code,
      errorMessage: spendError.message,
      outcome: "operator_required",
      level: "ERROR",
      reasonCategory: "session_spend_limit",
    });

    expect(ctx.deps.sessionRepo.setStatus).toHaveBeenCalledWith(
      "attention_required",
      "session-1",
    );
  });

  it("keeps session active for session_capacity outcomes", () => {
    const ctx = createContext();
    const capError = classifyRiskGateRejection({ gateType: "concurrent_cap" });

    ctx.handleStepFailure("risk_gate", "cycle-1", {
      ok: false,
      retryable: false,
      errorCode: (capError as AppError).code,
      errorMessage: capError.message,
      outcome: "session_capacity",
      level: "WARN",
      reasonCategory: "session_capacity",
    });

    expect(ctx.deps.sessionRepo.setStatus).not.toHaveBeenCalled();
  });

  it("throws operator_required when max data spend is exhausted", () => {
    const apiCallLogRepo = {
      dailyDataSpendUsd: () => 5,
    };

    expect(() =>
      assertSessionDataSpendAvailable({
        sessionId: "session-1",
        apiCallLogRepo: apiCallLogRepo as never,
        maxDataSpendUsd: 5,
      }),
    ).toThrow(AppError);

    try {
      assertSessionDataSpendAvailable({
        sessionId: "session-1",
        apiCallLogRepo: apiCallLogRepo as never,
        maxDataSpendUsd: 5,
      });
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).details).toMatchObject({
        outcome: "operator_required",
        reasonCategory: "session_spend_limit",
      });
    }
  });

  it("prunes failure history older than one hour before selector context reads", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-24T12:00:00.000Z"));
    const ctx = createContext();

    ctx.recordFailure({
      cycleId: "selector-1",
      stage: "selector_cycle",
      outcome: "no_trade",
      level: "WARN",
      code: null,
      message: "No instruments",
      reasonCategory: "model_no_trade",
    });
    expect(ctx.getFailureHistory()).toHaveLength(1);
    expect(ctx.getNearestRetryAt()).not.toBeNull();

    vi.setSystemTime(new Date("2026-05-24T13:01:00.000Z"));
    expect(ctx.getFailureHistory()).toHaveLength(0);
    expect(ctx.getNearestRetryAt()).toBeNull();
    vi.useRealTimers();
  });
});

function createContext() {
  return new TradingCycleContext("session-1", {
    sessionRepo: {
      getStatus: () => "active",
      setStatus: vi.fn(),
    },
    strategyContextService: {
      get: () => ({
        riskConfig: { waitForOpenThreshold: 0.8 },
      }),
    },
    sessionSelectorSettingsRepo: {
      get: () => ({ noInstrumentRetryMinutes: 5 }),
    },
    sessionExecutionStepsRepo: {
      upsert: vi.fn(),
      get: vi.fn(),
    },
    eventsRepo: {
      insert: vi.fn((event) => ({ id: "event-1", ...event })),
    },
    bus: { emit: vi.fn() },
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
  } as never);
}
