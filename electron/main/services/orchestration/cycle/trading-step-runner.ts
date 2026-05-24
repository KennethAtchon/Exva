import type { ExecutionStage, ExecutionStepState } from "@/lib/types";
import { RUNTIME_DEFAULTS } from "@electron/shared/ai/ai-phase";
import { AppError, type AppErrorCode } from "@electron/shared/infra/errors";
import type { SessionExecutionStepsRepo } from "../../../db/repositories/sessions/session-execution-steps-repo";
import type { EventBus } from "../../infra/event-bus";
import type { Logger } from "../../infra/log";
import {
  isFailureHistoryReasonCategory,
  isOrchestrationOutcome,
  outcomeLevel,
  type FailureHistoryLevel,
  type FailureHistoryReasonCategory,
  type OrchestrationOutcome,
} from "./runtime-outcome";

export type { ExecutionStage, ExecutionStepState } from "@/lib/types";

export type TradingStepResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      retryable: boolean;
      errorCode: string;
      errorMessage: string;
      outcome: OrchestrationOutcome;
      level: FailureHistoryLevel;
      reasonCategory: FailureHistoryReasonCategory;
    };

export interface TradingStepRunnerDeps {
  stepsRepo: SessionExecutionStepsRepo;
  bus: EventBus;
  logger: Logger;
}

export interface StepRetrySchedule {
  stage: ExecutionStage;
  attempt: number;
  nextRetryAt: string;
}

export interface TradingStepRunOptions {
  skipIfPreviouslySucceeded?: boolean;
  onRetry?: (retry: StepRetrySchedule) => void;
}

const STEP_RETRY_BACKOFF_MS = RUNTIME_DEFAULTS.retry.stepBackoffMs;
const MAX_STEP_RETRIES = STEP_RETRY_BACKOFF_MS.length;
const MAX_STEP_ATTEMPTS = MAX_STEP_RETRIES + 1;

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

export class TradingStepRunner {
  private readonly retryTimers = new Map<
    ExecutionStage,
    ReturnType<typeof setTimeout>
  >();

  constructor(
    private readonly sessionId: string,
    private readonly cycleId: string,
    private readonly deps: TradingStepRunnerDeps,
  ) {}

  dispose(): void {
    for (const timer of this.retryTimers.values()) clearTimeout(timer);
    this.retryTimers.clear();
  }

  get(stage: ExecutionStage): ExecutionStepState | null {
    return this.deps.stepsRepo.get(this.sessionId, this.cycleId, stage);
  }

  async run<T>(
    stage: ExecutionStage,
    fn: () => Promise<T>,
    opts: TradingStepRunOptions = {},
  ): Promise<TradingStepResult<T>> {
    const previous = this.get(stage);
    if (opts.skipIfPreviouslySucceeded && previous?.status === "succeeded") {
      return { ok: true, value: undefined as T };
    }

    this.clearRetry(stage);

    const attempt = (previous?.attempt ?? 0) + 1;
    const startedAt = new Date().toISOString();
    this.deps.stepsRepo.upsert({
      sessionId: this.sessionId,
      cycleId: this.cycleId,
      stage,
      status: "running",
      attempt,
      startedAt,
      completedAt: null,
      nextRetryAt: null,
      lastErrorCode: null,
      lastErrorMessage: null,
      retryable: false,
    });
    this.deps.bus.emit("step:started", {
      sessionId: this.sessionId,
      cycleId: this.cycleId,
      stage,
      attempt,
    });

    try {
      const value = await fn();
      this.deps.stepsRepo.upsert({
        sessionId: this.sessionId,
        cycleId: this.cycleId,
        stage,
        status: "succeeded",
        attempt,
        startedAt,
        completedAt: new Date().toISOString(),
        nextRetryAt: null,
        lastErrorCode: null,
        lastErrorMessage: null,
        retryable: false,
      });
      this.deps.bus.emit("step:succeeded", {
        sessionId: this.sessionId,
        cycleId: this.cycleId,
        stage,
      });
      return { ok: true, value };
    } catch (error) {
      const classified = classifyStepError(error);
      const retryAllowed = classified.retryable && attempt < MAX_STEP_ATTEMPTS;
      const nextRetryAt = retryAllowed ? computeNextRetryAt(attempt) : null;
      const status = retryAllowed ? "retrying" : "failed";

      this.deps.stepsRepo.upsert({
        sessionId: this.sessionId,
        cycleId: this.cycleId,
        stage,
        status,
        attempt,
        startedAt,
        completedAt: retryAllowed ? null : new Date().toISOString(),
        nextRetryAt,
        lastErrorCode: classified.errorCode,
        lastErrorMessage: classified.errorMessage,
        retryable: retryAllowed,
      });

      this.deps.bus.emit("step:failed", {
        sessionId: this.sessionId,
        cycleId: this.cycleId,
        stage,
        retryable: retryAllowed,
        errorCode: classified.errorCode,
        errorMessage: classified.errorMessage,
        nextRetryAt,
      });

      if (retryAllowed && nextRetryAt) {
        this.deps.bus.emit("step:retrying", {
          sessionId: this.sessionId,
          cycleId: this.cycleId,
          stage,
          attempt,
          nextRetryAt,
        });
        const delayMs = Math.max(0, Date.parse(nextRetryAt) - Date.now());
        const timer = setTimeout(() => {
          this.retryTimers.delete(stage);
          opts.onRetry?.({ stage, attempt, nextRetryAt });
        }, delayMs);
        this.retryTimers.set(stage, timer);
      }

      this.deps.logger.warn(
        {
          sessionId: this.sessionId,
          cycleId: this.cycleId,
          stage,
          attempt,
          retryable: retryAllowed,
          errorCode: classified.errorCode,
          errorMessage: classified.errorMessage,
        },
        "execution step failed",
      );

      return {
        ok: false,
        retryable: retryAllowed,
        errorCode: classified.errorCode,
        errorMessage: classified.errorMessage,
        outcome: classified.outcome,
        level: outcomeLevel(classified.outcome, retryAllowed),
        reasonCategory: classified.reasonCategory,
      };
    }
  }

  private clearRetry(stage: ExecutionStage): void {
    const timer = this.retryTimers.get(stage);
    if (!timer) return;
    clearTimeout(timer);
    this.retryTimers.delete(stage);
  }
}

function classifyStepError(error: unknown): {
  retryable: boolean;
  errorCode: string;
  errorMessage: string;
  outcome: OrchestrationOutcome;
  reasonCategory: FailureHistoryReasonCategory;
} {
  if (error instanceof AppError) {
    const details = error.details as Record<string, unknown> | undefined;
    const outcome = isOrchestrationOutcome(details?.outcome)
      ? details.outcome
      : defaultOutcomeForAppError(error.code, details?.retryable === true);
    const reasonCategory = isFailureHistoryReasonCategory(details?.reasonCategory)
      ? details.reasonCategory
      : defaultReasonCategory(error.code, outcome);
    if (error.details?.retryable === true) {
      return {
        retryable: true,
        errorCode: error.code,
        errorMessage: error.message,
        outcome,
        reasonCategory,
      };
    }
    return {
      retryable: false,
      errorCode: error.code,
      errorMessage: error.message,
      outcome,
      reasonCategory,
    };
  }

  const httpStatus = readHttpStatus(error);
  if (
    httpStatus === 408 ||
    httpStatus === 429 ||
    (httpStatus != null && httpStatus >= 500)
  ) {
    return {
      retryable: true,
      errorCode: `HTTP_${httpStatus}`,
      errorMessage:
        error instanceof Error ? error.message : `HTTP ${httpStatus}`,
      outcome: "transient",
      reasonCategory: "provider_transient",
    };
  }

  const message = error instanceof Error ? error.message : String(error);
  if (/timeout|timed out|etimedout|econnreset|temporar/i.test(message)) {
    return {
      retryable: true,
      errorCode: "TRANSIENT_ERROR",
      errorMessage: message,
      outcome: "transient",
      reasonCategory: "provider_transient",
    };
  }

  return {
    retryable: false,
    errorCode: inferUnknownCode(error),
    errorMessage: message,
    outcome: "bug",
    reasonCategory: "unexpected_bug",
  };
}

function defaultOutcomeForAppError(
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

function defaultReasonCategory(
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

function readHttpStatus(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const record = error as Record<string, unknown>;
  const value =
    record.status ??
    record.statusCode ??
    (record.response as Record<string, unknown> | undefined)?.status;
  return typeof value === "number" ? value : null;
}

function inferUnknownCode(error: unknown): AppErrorCode | "UNKNOWN_ERROR" {
  if (error instanceof AppError) return error.code;
  return "UNKNOWN_ERROR";
}

function computeNextRetryAt(attempt: number): string {
  const backoffMs =
    STEP_RETRY_BACKOFF_MS[Math.max(0, attempt - 1)] ??
    STEP_RETRY_BACKOFF_MS[STEP_RETRY_BACKOFF_MS.length - 1];
  const jitterMs = Math.random() * 5_000;
  return new Date(Date.now() + backoffMs + jitterMs).toISOString();
}
