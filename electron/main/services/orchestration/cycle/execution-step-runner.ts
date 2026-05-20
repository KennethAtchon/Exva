import type { ExecutionStage, ExecutionStepState } from "@/lib/types";
import { RUNTIME_DEFAULTS } from "@electron/shared/ai/pipeline-phase";
import { AppError, type AppErrorCode } from "@electron/shared/infra/errors";
import type { SessionExecutionStepsRepo } from "../../../db/repositories/sessions/session-execution-steps-repo";
import type { EventBus } from "../../infra/event-bus";
import type { Logger } from "../../infra/log";

export type { ExecutionStage, ExecutionStepState } from "@/lib/types";

export type StepResult<T> =
  | { ok: true; value: T }
  | { ok: false; retryable: boolean; errorCode: string; errorMessage: string };

export interface StepRunnerDeps {
  stepsRepo: SessionExecutionStepsRepo;
  bus: EventBus;
  logger: Logger;
}

export interface ScheduledRetry {
  stage: ExecutionStage;
  attempt: number;
  nextRetryAt: string;
}

export interface StepRunOptions {
  skipIfPreviouslySucceeded?: boolean;
  onRetry?: (retry: ScheduledRetry) => void;
}

const STEP_RETRY_BACKOFF_MS = RUNTIME_DEFAULTS.retry.stepBackoffMs;
const MAX_STEP_RETRIES = STEP_RETRY_BACKOFF_MS.length;
const MAX_STEP_ATTEMPTS = MAX_STEP_RETRIES + 1;

export class ExecutionStepRunner {
  private readonly retryTimers = new Map<ExecutionStage, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly sessionId: string,
    private readonly cycleId: string,
    private readonly deps: StepRunnerDeps,
  ) {}

  dispose(): void {
    for (const timer of this.retryTimers.values()) clearTimeout(timer);
    this.retryTimers.clear();
  }

  get(stage: ExecutionStage): ExecutionStepState | null {
    return this.deps.stepsRepo.get(this.sessionId, this.cycleId, stage);
  }

  async run<T>(stage: ExecutionStage, fn: () => Promise<T>, opts: StepRunOptions = {}): Promise<StepResult<T>> {
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
    this.deps.bus.emit("step:started", { sessionId: this.sessionId, cycleId: this.cycleId, stage, attempt });

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
      this.deps.bus.emit("step:succeeded", { sessionId: this.sessionId, cycleId: this.cycleId, stage });
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

function classifyStepError(error: unknown): { retryable: boolean; errorCode: string; errorMessage: string } {
  if (error instanceof AppError) {
    if (["VALIDATION_FAILED", "PROVIDER_NOT_CONFIGURED", "LOCKED"].includes(error.code)) {
      return { retryable: false, errorCode: error.code, errorMessage: error.message };
    }
    if (error.details?.retryable === true) {
      return { retryable: true, errorCode: error.code, errorMessage: error.message };
    }
    return { retryable: false, errorCode: error.code, errorMessage: error.message };
  }

  const httpStatus = readHttpStatus(error);
  if (httpStatus === 408 || httpStatus === 429 || (httpStatus != null && httpStatus >= 500)) {
    return {
      retryable: true,
      errorCode: `HTTP_${httpStatus}`,
      errorMessage: error instanceof Error ? error.message : `HTTP ${httpStatus}`,
    };
  }

  const message = error instanceof Error ? error.message : String(error);
  if (/timeout|timed out|etimedout|econnreset|temporar/i.test(message)) {
    return { retryable: true, errorCode: "TRANSIENT_ERROR", errorMessage: message };
  }

  return { retryable: false, errorCode: inferUnknownCode(error), errorMessage: message };
}

function readHttpStatus(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const record = error as Record<string, unknown>;
  const value = record.status ?? record.statusCode ?? (record.response as Record<string, unknown> | undefined)?.status;
  return typeof value === "number" ? value : null;
}

function inferUnknownCode(error: unknown): AppErrorCode | "UNKNOWN_ERROR" {
  if (error instanceof AppError) return error.code;
  return "UNKNOWN_ERROR";
}

function computeNextRetryAt(attempt: number): string {
  const backoffMs = STEP_RETRY_BACKOFF_MS[Math.max(0, attempt - 1)] ?? STEP_RETRY_BACKOFF_MS[STEP_RETRY_BACKOFF_MS.length - 1];
  const jitterMs = Math.random() * 5_000;
  return new Date(Date.now() + backoffMs + jitterMs).toISOString();
}
