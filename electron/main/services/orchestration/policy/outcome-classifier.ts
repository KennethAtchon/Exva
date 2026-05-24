import { AppError, type AppErrorCode } from "@electron/shared/infra/errors";
import type { RiskGateType } from "../../risk/risk-engine";
import {
  createOutcomeError,
  isFailureHistoryReasonCategory,
  isOrchestrationOutcome,
  type FailureHistoryReasonCategory,
  type OrchestrationOutcome,
} from "../cycle/runtime-outcome";

const OPERATOR_REQUIRED_CODES = new Set<AppErrorCode>([
  "LOCKED",
  "MISSING_SECRET",
  "NO_BROKER",
  "PROVIDER_NOT_CONFIGURED",
  "SEARCH_PROVIDER_REQUIRED",
  "SPEND_CAP_EXCEEDED",
  "UNSUPPORTED_INSTRUMENT",
]);

const NO_TRADE_CODES = new Set<AppErrorCode>(["INSTRUMENT_CONFLICT"]);

const SESSION_CAPACITY_CODES = new Set<AppErrorCode>([
  "BROKER_ALLOCATION_EXCEEDED",
  "BROKER_SESSION_CAP_EXCEEDED",
  "CAPITAL_POOL_EXCEEDED",
]);

export function defaultOutcomeForAppError(
  code: AppErrorCode,
  retryable: boolean,
): OrchestrationOutcome {
  if (retryable) return "transient";
  if (OPERATOR_REQUIRED_CODES.has(code)) return "operator_required";
  if (SESSION_CAPACITY_CODES.has(code)) return "session_capacity";
  if (NO_TRADE_CODES.has(code)) return "no_trade";
  if (
    code === "PROVIDER_UNREACHABLE" ||
    code === "BROKER_UNREACHABLE" ||
    code === "BROKER_ERROR" ||
    code === "VALIDATION_FAILED"
  ) {
    return "transient";
  }
  return "bug";
}

export function defaultReasonCategory(
  code: AppErrorCode,
  outcome: OrchestrationOutcome,
): FailureHistoryReasonCategory {
  if (code === "SPEND_CAP_EXCEEDED") return "session_spend_limit";
  if (code === "INSTRUMENT_CONFLICT") return "broker_allocation";
  if (SESSION_CAPACITY_CODES.has(code)) return "session_capacity";
  if (code === "PROVIDER_UNREACHABLE" || code === "BROKER_UNREACHABLE") {
    return "provider_transient";
  }
  if (outcome === "transient") return "unexpected_bug";
  if (outcome === "no_trade") return "risk_gate";
  return "unexpected_bug";
}

export function classifyAppError(error: AppError): {
  retryable: boolean;
  errorCode: string;
  errorMessage: string;
  outcome: OrchestrationOutcome;
  reasonCategory: FailureHistoryReasonCategory;
} {
  const details = error.details as Record<string, unknown> | undefined;
  const outcome = isOrchestrationOutcome(details?.outcome)
    ? details.outcome
    : defaultOutcomeForAppError(error.code, details?.retryable === true);
  const reasonCategory = isFailureHistoryReasonCategory(details?.reasonCategory)
    ? details.reasonCategory
    : defaultReasonCategory(error.code, outcome);
  const retryable = details?.retryable === true;
  return {
    retryable,
    errorCode: error.code,
    errorMessage: error.message,
    outcome,
    reasonCategory,
  };
}

export function classifyRiskGateRejection(input: {
  reason?: string;
  gateType?: RiskGateType;
}): AppError {
  const gateType = input.gateType ?? inferRiskGateTypeFromReason(input.reason);
  const reason = input.reason ?? "Trade rejected by risk engine";

  switch (gateType) {
    case "concurrent_cap":
      return createOutcomeError(reason, "VALIDATION_FAILED", {
        outcome: "session_capacity",
        reasonCategory: "session_capacity",
      });
    case "api_budget":
      return createOutcomeError(reason, "SPEND_CAP_EXCEEDED", {
        outcome: "operator_required",
        reasonCategory: "session_spend_limit",
      });
    case "daily_loss":
    case "profit_target":
      return createOutcomeError(reason, "SPEND_CAP_EXCEEDED", {
        outcome: "operator_required",
        reasonCategory: "session_pnl_limit",
      });
    default:
      return createOutcomeError(reason, "VALIDATION_FAILED", {
        outcome: "no_trade",
        reasonCategory: "risk_gate",
      });
  }
}

export function createOrderPolicyError(
  message: string,
  gatesFailed: string[],
): AppError {
  if (
    gatesFailed.includes("capital") ||
    gatesFailed.includes("strategy") ||
    gatesFailed.includes("data_freshness") ||
    gatesFailed.includes("price_collar") ||
    gatesFailed.includes("spread") ||
    gatesFailed.includes("exit_contract") ||
    gatesFailed.includes("broker") ||
    gatesFailed.includes("idempotency")
  ) {
    return createOutcomeError(message, "VALIDATION_FAILED", {
      outcome: "no_trade",
      reasonCategory: "risk_gate",
    });
  }

  if (gatesFailed.includes("runtime")) {
    return createOutcomeError(message, "LOCKED", {
      outcome: "operator_required",
      reasonCategory: "unexpected_bug",
    });
  }

  return createOutcomeError(message, "VALIDATION_FAILED", {
    outcome: "no_trade",
    reasonCategory: "broker_reject",
  });
}

function inferRiskGateTypeFromReason(reason?: string): RiskGateType | undefined {
  switch (reason) {
    case "Maximum concurrent trades reached":
      return "concurrent_cap";
    case "Daily API budget reached":
      return "api_budget";
    case "Daily loss limit reached":
      return "daily_loss";
    case "Profit target reached":
      return "profit_target";
    default:
      return undefined;
  }
}
