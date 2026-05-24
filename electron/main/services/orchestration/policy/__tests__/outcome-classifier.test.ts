import { describe, expect, it } from "vitest";
import { AppError } from "@electron/shared/infra/errors";
import {
  classifyAppError,
  classifyRiskGateRejection,
  createOrderPolicyError,
  defaultOutcomeForAppError,
} from "../outcome-classifier";

describe("outcome-classifier", () => {
  it("classifies risk gate rejections by structured gateType", () => {
    const cap = classifyRiskGateRejection({ gateType: "concurrent_cap" });
    expect((cap as AppError).details).toMatchObject({
      outcome: "session_capacity",
    });

    const spend = classifyRiskGateRejection({ gateType: "api_budget" });
    expect((spend as AppError).details).toMatchObject({
      outcome: "operator_required",
      reasonCategory: "session_spend_limit",
    });

    const pnl = classifyRiskGateRejection({ gateType: "daily_loss" });
    expect((pnl as AppError).details).toMatchObject({
      outcome: "operator_required",
      reasonCategory: "session_pnl_limit",
    });
  });

  it("falls back to reason strings when gateType is missing", () => {
    const error = classifyRiskGateRejection({
      reason: "Daily API budget reached",
    });
    expect((error as AppError).details).toMatchObject({
      outcome: "operator_required",
      reasonCategory: "session_spend_limit",
    });
  });

  it("respects explicit outcome on AppError", () => {
    const error = new AppError("blocked", "VALIDATION_FAILED", {
      outcome: "operator_required",
      reasonCategory: "session_spend_limit",
    });
    expect(classifyAppError(error)).toMatchObject({
      outcome: "operator_required",
      reasonCategory: "session_spend_limit",
      retryable: false,
    });
  });

  it("maps spend cap codes to operator_required by default", () => {
    expect(defaultOutcomeForAppError("SPEND_CAP_EXCEEDED", false)).toBe(
      "operator_required",
    );
  });

  it("maps order policy runtime gate failures to operator_required", () => {
    const error = createOrderPolicyError("Session is paused", ["runtime"]);
    expect((error as AppError).details).toMatchObject({
      outcome: "operator_required",
    });
  });
});
