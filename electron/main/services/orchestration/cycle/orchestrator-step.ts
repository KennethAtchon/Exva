import type { ExecutionStage } from "@/lib/types";
import type { StepResult } from "./execution-step-runner";
import type { OrchestratorContext } from "./orchestrator-context";
import type { CycleContext } from "./types";

export type OrchestratorStepOutcome<T> =
  | { status: "ok"; value: T }
  | { status: "paused" }
  | { status: "failed"; result: Extract<StepResult<T>, { ok: false }> };

export function enqueueCycleTask(
  ctx: OrchestratorContext,
  cycleId: string,
  errorLabel: string,
  execute: () => Promise<void>,
): void {
  if (!ctx.runtimeIsActive()) return;
  ctx.enqueueTask(execute, (error) => {
    ctx.emitEvent(
      "ERROR",
      null,
      `${errorLabel}: ${error instanceof Error ? error.message : String(error)}`,
      "orchestrator",
      cycleId,
    );
  });
}

export async function runOrchestratorStep<T>(
  ctx: OrchestratorContext,
  options: {
    cycleId: string;
    stage: ExecutionStage;
    run: () => Promise<T>;
    onRetry?: () => void;
    tradeId?: string | null;
    onFailure?: (result: Extract<StepResult<T>, { ok: false }>) => void;
    recordFailure?: boolean;
  },
): Promise<OrchestratorStepOutcome<T>> {
  const result = await ctx
    .getStepRunner(options.cycleId)
    .run(options.stage, options.run, {
      onRetry: options.onRetry,
    });

  if (await ctx.pauseIfRequested(options.cycleId)) {
    return { status: "paused" };
  }

  if (!result.ok) {
    if (options.onFailure) {
      options.onFailure(result);
    } else if (options.recordFailure !== false) {
      ctx.handleStepFailure(
        options.stage,
        options.cycleId,
        result,
        options.tradeId ?? null,
      );
    }
    return { status: "failed", result };
  }

  return { status: "ok", value: result.value };
}

export type PhaseCycleBusEvents = {
  phase: string;
  started?: boolean;
  failed?: boolean;
  complete?: boolean;
};

/** Runs a single-step research/selector-style cycle with shared retry, pause, and bus events. */
export async function runPhaseCycle<TContext extends CycleContext, TResult>(
  ctx: OrchestratorContext,
  options: {
    context: TContext;
    stage: ExecutionStage;
    prepare?: () => void;
    run: () => Promise<TResult>;
    retryCycle: () => Promise<void>;
    onSuccess: (value: TResult) => void | Promise<void>;
    retryErrorLabel?: string;
    busEvents?: PhaseCycleBusEvents;
    completePayload: (value: TResult) => Record<string, unknown>;
  },
): Promise<void> {
  if (!ctx.runtimeIsActive()) return;

  ctx.cycleContexts.set(options.context.cycleId, options.context);
  options.prepare?.();

  const phase = options.busEvents?.phase;
  if (phase && options.busEvents?.started !== false) {
    ctx.deps.bus.emit("research_phase_started", {
      sessionId: ctx.sessionId,
      phase,
      cycleId: options.context.cycleId,
    });
  }

  const outcome = await runOrchestratorStep(ctx, {
    cycleId: options.context.cycleId,
    stage: options.stage,
    run: options.run,
    onRetry: () =>
      enqueueCycleTask(
        ctx,
        options.context.cycleId,
        options.retryErrorLabel ?? `Scheduled ${options.stage} retry failed`,
        options.retryCycle,
      ),
    recordFailure: false,
  });

  if (outcome.status === "paused") return;

  if (outcome.status === "failed") {
    ctx.handleStepFailure(
      options.stage,
      options.context.cycleId,
      outcome.result,
    );
    if (phase && options.busEvents?.failed !== false) {
      ctx.deps.bus.emit("research_phase_failed", {
        sessionId: ctx.sessionId,
        phase,
        cycleId: options.context.cycleId,
        error: outcome.result.errorMessage,
      });
    }
    return;
  }

  ctx.clearAttentionRequired();
  if (phase && options.busEvents?.complete !== false) {
    ctx.deps.bus.emit("research_phase_complete", {
      sessionId: ctx.sessionId,
      phase,
      cycleId: options.context.cycleId,
      ...options.completePayload(outcome.value),
    } as {
      sessionId: string;
      phase: string;
      cycleId: string;
      instrumentCount: number;
    });
  }
  await options.onSuccess(outcome.value);
}
