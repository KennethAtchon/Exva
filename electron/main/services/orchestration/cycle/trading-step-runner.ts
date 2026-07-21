import type { ExecutionStage, ExecutionStepState } from "@/lib/types";
import { RUNTIME_DEFAULTS } from "@electron/shared/ai/ai-phase";
import { AppError, type AppErrorCode } from "@electron/shared/infra/errors";
import type { SessionExecutionStepsRepo } from "../../../db/repositories/sessions/session-execution-steps-repo";
import type { EventBus } from "../../infra/event-bus";
import type { Logger } from "../../infra/log";
import { classifyAppError } from "../policy/outcome-classifier";
import {
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

interface StepRetrySchedule {
  stage: ExecutionStage;
  attempt: number;
  nextRetryAt: string;
}

export interface TradingStepRunOptions {
  skipIfPreviouslySucceeded?: boolean;
  onRetry?: (retry: StepRetrySchedule) => void;
  /** Optional success-path outcome (e.g. empty selector → `no_trade`). */
  successOutcome?: (value: unknown) => OrchestrationOutcome | null;
}

const STEP_RETRY_BACKOFF_MS = RUNTIME_DEFAULTS.retry.stepBackoffMs;
const MAX_STEP_RETRIES = STEP_RETRY_BACKOFF_MS.length;
const MAX_STEP_ATTEMPTS = MAX_STEP_RETRIES + 1;

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
      outcome: null,
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
        outcome: opts.successOutcome?.(value) ?? null,
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
        outcome: classified.outcome,
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
    const classified = classifyAppError(error);
    if (error.details?.retryable === true) {
      return { ...classified, retryable: true };
    }
    return { ...classified, retryable: false };
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
