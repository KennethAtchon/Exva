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

  it("maps unreachable broker/provider codes to transient, not operator_required", () => {
    expect(defaultOutcomeForAppError("BROKER_UNREACHABLE", false)).toBe(
      "transient",
    );
    expect(defaultOutcomeForAppError("PROVIDER_UNREACHABLE", false)).toBe(
      "transient",
    );
    expect(defaultOutcomeForAppError("BROKER_UNREACHABLE", true)).toBe(
      "transient",
    );

    const brokerError = new AppError("broker down", "BROKER_UNREACHABLE");
    expect(classifyAppError(brokerError)).toMatchObject({
      outcome: "transient",
      reasonCategory: "provider_transient",
    });
  });

  it("maps spend cap and PnL limit codes to operator_required with reasonCategory", () => {
    expect(
      (classifyRiskGateRejection({ gateType: "profit_target" }) as AppError)
        .details,
    ).toMatchObject({
      outcome: "operator_required",
      reasonCategory: "session_pnl_limit",
    });

    const spendError = new AppError("cap hit", "SPEND_CAP_EXCEEDED");
    expect(classifyAppError(spendError)).toMatchObject({
      outcome: "operator_required",
      reasonCategory: "session_spend_limit",
    });
  });

  it("maps INSTRUMENT_CONFLICT to no_trade", () => {
    expect(defaultOutcomeForAppError("INSTRUMENT_CONFLICT", false)).toBe(
      "no_trade",
    );
    const conflict = new AppError("symbol in use", "INSTRUMENT_CONFLICT");
    expect(classifyAppError(conflict)).toMatchObject({
      outcome: "no_trade",
      reasonCategory: "broker_allocation",
    });
  });

  it("maps order policy gate failures to no_trade except runtime pause", () => {
    for (const gate of [
      "data_freshness",
      "price_collar",
      "spread",
      "strategy",
      "idempotency",
      "exit_contract",
      "broker",
    ] as const) {
      const error = createOrderPolicyError(`blocked by ${gate}`, [gate]);
      expect((error as AppError).details).toMatchObject({
        outcome: "no_trade",
        reasonCategory: "risk_gate",
      });
    }
  });

  it("maps non-fatal risk gate denials to no_trade", () => {
    for (const gateType of [
      "volatility_halt",
      "confidence",
      "position_size",
      "consecutive_losers",
    ] as const) {
      const error = classifyRiskGateRejection({ gateType });
      expect((error as AppError).details).toMatchObject({
        outcome: "no_trade",
        reasonCategory: "risk_gate",
      });
    }
  });
});
