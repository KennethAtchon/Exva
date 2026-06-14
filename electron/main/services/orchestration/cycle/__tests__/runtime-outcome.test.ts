import { describe, expect, it } from "vitest";
import { AppError } from "@electron/shared/infra/errors";
import {
  createOutcomeError,
  isFailureHistoryReasonCategory,
  isOrchestrationOutcome,
  outcomeLevel,
} from "../runtime-outcome";

describe("runtime-outcome helpers", () => {
  it("isOrchestrationOutcome accepts known outcomes only", () => {
    expect(isOrchestrationOutcome("no_trade")).toBe(true);
    expect(isOrchestrationOutcome("transient")).toBe(true);
    expect(isOrchestrationOutcome("session_capacity")).toBe(true);
    expect(isOrchestrationOutcome("operator_required")).toBe(true);
    expect(isOrchestrationOutcome("bug")).toBe(true);
    expect(isOrchestrationOutcome("unknown")).toBe(false);
    expect(isOrchestrationOutcome(null)).toBe(false);
  });

  it("isFailureHistoryReasonCategory accepts known categories only", () => {
    expect(isFailureHistoryReasonCategory("model_no_trade")).toBe(true);
    expect(isFailureHistoryReasonCategory("provider_transient")).toBe(true);
    expect(isFailureHistoryReasonCategory("unexpected_bug")).toBe(true);
    expect(isFailureHistoryReasonCategory("not_a_category")).toBe(false);
  });

  it("outcomeLevel maps no_trade and session_capacity to WARN", () => {
    expect(outcomeLevel("no_trade")).toBe("WARN");
    expect(outcomeLevel("session_capacity")).toBe("WARN");
  });

  it("outcomeLevel maps retryable transient to WARN and non-retryable to ERROR", () => {
    expect(outcomeLevel("transient", true)).toBe("WARN");
    expect(outcomeLevel("transient", false)).toBe("ERROR");
  });

  it("outcomeLevel maps operator_required and bug to ERROR", () => {
    expect(outcomeLevel("operator_required")).toBe("ERROR");
    expect(outcomeLevel("bug")).toBe("ERROR");
  });

  it("createOutcomeError attaches outcome details to AppError", () => {
    const error = createOutcomeError(
      "Broker unreachable",
      "BROKER_UNREACHABLE",
      {
        outcome: "transient",
        reasonCategory: "provider_transient",
        retryable: true,
      },
    );

    expect(error).toBeInstanceOf(AppError);
    expect(error.code).toBe("BROKER_UNREACHABLE");
    expect(error.details).toMatchObject({
      outcome: "transient",
      reasonCategory: "provider_transient",
      level: "WARN",
      retryable: true,
    });
  });
});
