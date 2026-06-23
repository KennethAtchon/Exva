import { AppError, type AppErrorCode } from "@electron/shared/infra/errors";
import type { ExecutionStage, InstrumentClass } from "@/lib/types";

export type OrchestrationOutcome =
  | "no_trade"
  | "transient"
  | "session_capacity"
  | "operator_required"
  | "bug";

export type FailureHistoryLevel = "WARN" | "ERROR";

export type FailureHistoryReasonCategory =
  | "model_no_trade"
  | "risk_gate"
  | "broker_allocation"
  | "broker_capability"
  | "broker_reject"
  | "session_capacity"
  | "session_spend_limit"
  | "session_pnl_limit"
  | "provider_transient"
  | "unexpected_bug";

export interface FailureHistoryEntry {
  occurredAt: string;
  expiresAt: string;
  retryAt: string | null;
  cycleId: string;
  instrumentSymbol: string | null;
  instrumentClass: InstrumentClass | null;
  stage: ExecutionStage | "trade_cycle" | "selector_cycle";
  outcome: OrchestrationOutcome;
  level: FailureHistoryLevel;
  code: string | null;
  message: string;
  reasonCategory: FailureHistoryReasonCategory;
}

export interface RuntimeOutcomeDetails {
  outcome: OrchestrationOutcome;
  level?: FailureHistoryLevel;
  reasonCategory?: FailureHistoryReasonCategory;
  retryable?: boolean;
}

const OUTCOMES: OrchestrationOutcome[] = [
  "no_trade",
  "transient",
  "session_capacity",
  "operator_required",
  "bug",
];

const REASON_CATEGORIES: FailureHistoryReasonCategory[] = [
  "model_no_trade",
  "risk_gate",
  "broker_allocation",
  "broker_capability",
  "broker_reject",
  "session_capacity",
  "session_spend_limit",
  "session_pnl_limit",
  "provider_transient",
  "unexpected_bug",
];

export function isOrchestrationOutcome(
  value: unknown,
): value is OrchestrationOutcome {
  return (
    typeof value === "string" &&
    OUTCOMES.includes(value as OrchestrationOutcome)
  );
}

export function isFailureHistoryReasonCategory(
  value: unknown,
): value is FailureHistoryReasonCategory {
  return (
    typeof value === "string" &&
    REASON_CATEGORIES.includes(value as FailureHistoryReasonCategory)
  );
}

export function outcomeLevel(
  outcome: OrchestrationOutcome,
  retryable = false,
): FailureHistoryLevel {
  if (outcome === "no_trade" || outcome === "session_capacity") {
    return "WARN";
  }
  if (outcome === "transient") {
    return retryable ? "WARN" : "ERROR";
  }
  return "ERROR";
}

function buildRuntimeOutcomeDetails(
  details: RuntimeOutcomeDetails,
): RuntimeOutcomeDetails {
  return {
    ...details,
    level: details.level ?? outcomeLevel(details.outcome, details.retryable),
  };
}

export function createOutcomeError(
  message: string,
  code: AppErrorCode,
  details: RuntimeOutcomeDetails,
): AppError {
  return new AppError(
    message,
    code,
    buildRuntimeOutcomeDetails(details) as unknown as Record<string, unknown>,
  );
}
