import { AppError } from "@electron/shared/infra/errors";
import type { LLMRunResult } from "../../llm/llm-types";
import type { WorkerDefinition } from "@electron/shared/ai/ai-phase";
import { resolveSessionInstrumentClasses } from "../../session/effective-instrument-classes";
import {
  resolveEngine,
  type CacheEngine,
  type EntryModeEngine,
  type FinalizerEngine,
  type InputEngine,
  type PhaseWorkerResult,
} from "../engines/registry";
import { assembleAggregateTrace } from "../execution/trace-assembler";
import type { AIPhaseServices } from "./services";
import type {
  AIPhase,
  AIPhaseContext,
  AIPhaseResult,
  AIWorkerTrace,
} from "./types";
import type { AIWorkerRunner } from "../core/types";
import type { WorkerToolContext } from "../worker-tools/worker-tool-factory";
import type { SessionStrategyContext } from "@electron/shared/domain";
import type { WorkspaceSession } from "@/lib/types";
import { createLogger } from "../../infra/log";

const logger = createLogger("pipeline-phase-runtime");

export interface AIPhaseRunInput {
  plan: AIPhase<unknown, unknown>;
  sessionId: string;
  cycleId: string | null;
  tradeId: string | null;
  input: Record<string, unknown>;
  session: WorkspaceSession;
  strategyContext: SessionStrategyContext;
  toolContext: WorkerToolContext;
  services: AIPhaseServices;
  runner: AIWorkerRunner;
}

export class AIPhaseRunner {
  async run<TOutput>(
    input: AIPhaseRunInput,
  ): Promise<AIPhaseResult<TOutput>> {
    const phaseStartedAt = Date.now();
    logger.info(
      {
        sessionId: input.sessionId,
        phase: input.plan.phase,
        cycleId: input.cycleId,
        tradeId: input.tradeId,
        stageCount: input.plan.stages.length,
        inputKeys: Object.keys(input.input).sort(),
        cacheEngineId: input.plan.cacheEngineId ?? null,
        entryModeCount: input.plan.entryEngineIds?.length ?? 0,
      },
      "phase plan start",
    );

    const instrumentClasses = resolveSessionInstrumentClasses(
      input.session,
      input.services,
    );
    const toolContext: WorkerToolContext = {
      ...input.toolContext,
      instrumentClasses,
    };
    const ctx: AIPhaseContext = {
      phase: input.plan.phase,
      sessionId: input.sessionId,
      cycleId: input.cycleId,
      tradeId: input.tradeId,
      session: input.session,
      instrumentClasses,
      strategyContext: input.strategyContext,
      toolContext,
      services: input.services,
      runner: input.runner,
      input: { ...input.input },
    };

    for (const entryEngineId of input.plan.entryEngineIds ?? []) {
      const entryEngine = resolveEngine<EntryModeEngine>(
        entryEngineId,
        "entry_mode",
      );
      if (!(await entryEngine.matches(ctx))) continue;
      logger.info(
        {
          sessionId: input.sessionId,
          phase: input.plan.phase,
          cycleId: input.cycleId,
          entryEngineId,
        },
        "phase plan entry mode matched",
      );
      const output = await entryEngine.resolve(ctx);
      return {
        output: (input.plan.filterOutput?.(output as never, ctx) ??
          output) as TOutput,
        // Entry engine declares its own source; defaults to "phase" if unset.
        source: entryEngine.source ?? "phase",
        instrumentClasses,
      };
    }

    let cacheFingerprint: string | null = null;
    let cacheEngine: CacheEngine | null = null;
    if (input.plan.cacheEngineId) {
      cacheEngine = resolveEngine<CacheEngine>(input.plan.cacheEngineId, "cache");
      cacheFingerprint = cacheEngine.fingerprint(ctx);
      const cached = cacheEngine.read(ctx, cacheFingerprint);
      if (cached) {
        logger.info(
          {
            sessionId: input.sessionId,
            phase: input.plan.phase,
            cycleId: input.cycleId,
            cacheEngineId: input.plan.cacheEngineId,
            fingerprint: cacheFingerprint,
          },
          "phase plan cache hit",
        );
        return {
          output: cached as TOutput,
          source: "cache",
          instrumentClasses,
        };
      }
    }

    if (input.plan.inputEngineIds?.length) {
      const inputKey = input.plan.inputKey ?? "selectionInstructions";
      const sections: string[] = [];
      for (const inputEngineId of input.plan.inputEngineIds) {
        const section = await resolveEngine<InputEngine>(
          inputEngineId,
          "input",
        ).build(ctx);
        if (section) sections.push(section);
      }
      ctx.input[inputKey] = sections.join("\n\n");
    }

    let state = input.plan.initialState
      ? await input.plan.initialState(ctx)
      : ({} as unknown);
    const workerTraces: AIWorkerTrace[] = [];
    const workerResults: PhaseWorkerResult[] = [];

    for (const stage of input.plan.stages) {
      const workers = stage.resolveWorkers(ctx, state);
      if (workers.length === 0) {
        logger.info(
          {
            sessionId: input.sessionId,
            phase: input.plan.phase,
            cycleId: input.cycleId,
            stageId: stage.id,
            frontier: stage.frontier,
          },
          "phase stage skipped (no workers)",
        );
        continue;
      }

      const stageStartedAt = Date.now();
      const workerIds = workers.map((worker) => worker.id);
      logger.info(
        {
          sessionId: input.sessionId,
          phase: input.plan.phase,
          cycleId: input.cycleId,
          stageId: stage.id,
          frontier: stage.frontier,
          workerIds,
          concurrency: stage.concurrency,
          minSuccessfulWorkers: stage.minSuccessfulWorkers ?? null,
          toleratePartialFailure: stage.toleratePartialFailure,
        },
        "phase stage start",
      );

      const settled = await ctx.runner.executeGroup(
        workers.map(
          (worker) => () =>
            ctx.runner
              .execute<unknown>(worker, stage.buildTask(ctx, state, worker))
              .then((result) => ({ worker, result })),
        ),
        stage.concurrency,
      );

      const results = settled
        .filter(
          (
            entry,
          ): entry is PromiseFulfilledResult<{
            worker: WorkerDefinition;
            result: LLMRunResult<unknown>;
          }> => entry.status === "fulfilled",
        )
        .map((entry) => entry.value);
      const rejectedReasons = settled
        .filter(
          (entry): entry is PromiseRejectedResult =>
            entry.status === "rejected",
        )
        .map((entry) => formatRejectionReason(entry.reason));

      logger.info(
        {
          sessionId: input.sessionId,
          phase: input.plan.phase,
          cycleId: input.cycleId,
          stageId: stage.id,
          frontier: stage.frontier,
          workerIds,
          successfulWorkers: results.map(({ worker }) => worker.id),
          failedWorkers: workerIds.filter(
            (workerId) =>
              !results.some(({ worker }) => worker.id === workerId),
          ),
          rejectedCount: rejectedReasons.length,
          durationMs: Date.now() - stageStartedAt,
        },
        "phase stage complete",
      );

      if (
        stage.minSuccessfulWorkers != null &&
        results.length < stage.minSuccessfulWorkers
      ) {
        throw new AppError(
          `Stage '${stage.id}' in phase '${input.plan.phase}' produced insufficient successful workers (${results.length}/${stage.minSuccessfulWorkers}).${formatRejectedReasons(rejectedReasons)}`,
          "VALIDATION_FAILED",
        );
      }

      if (!stage.toleratePartialFailure && results.length !== workers.length) {
        throw new AppError(
          `Stage '${stage.id}' in phase '${input.plan.phase}' failed worker execution.${formatRejectedReasons(rejectedReasons)}`,
          "VALIDATION_FAILED",
        );
      }

      for (const { worker, result } of results) {
        workerResults.push({ worker, result });
        workerTraces.push({
          workerId: worker.id,
          frontier: stage.frontier,
          dependsOn:
            stage.frontier === 0
              ? []
              : workerTraces
                  .filter((trace) => trace.frontier === 0)
                  .map((trace) => trace.workerId),
          requiredForPhase: stage.frontier === 0,
          run: result.run,
          message: result.message,
        });
      }

      state = stage.applyResults(ctx, state, results);
    }

    const finalized = await finalizePhaseOutput(
      input.plan,
      ctx,
      state,
      workerTraces,
      workerResults,
    );
    const output = (input.plan.filterOutput?.(finalized.output, ctx) ??
      finalized.output) as TOutput;
    const aggregate =
      finalized.aggregate ??
      assemblePhaseAggregate(input.plan, ctx, output, workerTraces);

    logger.info(
      {
        sessionId: input.sessionId,
        phase: input.plan.phase,
        cycleId: input.cycleId,
        tradeId: input.tradeId,
        workerTraceCount: workerTraces.length,
        workerIds: workerTraces.map((trace) => trace.workerId),
        source: "ai_picker",
        hasAggregate: Boolean(aggregate),
        aggregateCostUsd: aggregate?.run.cost_usd ?? null,
        durationMs: Date.now() - phaseStartedAt,
        ...(input.plan.summarize?.(output) ?? {}),
      },
      "phase plan complete",
    );

    if (aggregate && input.plan.persistAggregate !== false) {
      input.services.agentRunsRepo.insert({
        ...aggregate.run,
        session_id: ctx.sessionId,
        trade_id: ctx.tradeId,
      });
      input.services.agentMessagesRepo.insert({
        ...aggregate.message,
        session_id: ctx.sessionId,
        trade_id: ctx.tradeId,
      });
    }

    if (
      cacheEngine &&
      cacheFingerprint &&
      aggregate &&
      (cacheEngine.shouldWrite ? cacheEngine.shouldWrite(output) : output != null)
    ) {
      cacheEngine.write(ctx, cacheFingerprint, output, {
        agentRunId: aggregate.run.id,
        cycleId: ctx.cycleId ?? ctx.sessionId,
      });
    }

    return {
      output,
      source: "ai_picker",
      run: aggregate?.run as LLMRunResult<TOutput>["run"] | undefined,
      message: aggregate?.message as
        | LLMRunResult<TOutput>["message"]
        | undefined,
      instrumentClasses,
    };
  }
}

async function finalizePhaseOutput<TOutput>(
  plan: AIPhase<unknown, TOutput>,
  ctx: AIPhaseContext,
  state: unknown,
  workerTraces: AIWorkerTrace[],
  workerResults: PhaseWorkerResult[],
): Promise<{
  output: TOutput;
  aggregate?: {
    run: LLMRunResult<TOutput>["run"];
    message: LLMRunResult<TOutput>["message"];
  };
}> {
  if (plan.finalizeEngineIds?.length) {
    let current: unknown = state;
    for (const finalizerEngineId of plan.finalizeEngineIds) {
      current = await resolveEngine<FinalizerEngine>(
        finalizerEngineId,
        "finalizer",
      ).run(ctx, current, workerResults);
    }
    return { output: current as TOutput };
  }

  throw new AppError(
    `Phase '${plan.phase}' has no finalizer engines configured.`,
    "VALIDATION_FAILED",
  );
}

function assemblePhaseAggregate<TOutput>(
  plan: AIPhase<unknown, TOutput>,
  ctx: AIPhaseContext,
  output: TOutput,
  workerTraces: AIWorkerTrace[],
): {
  run: LLMRunResult<TOutput>["run"];
  message: LLMRunResult<TOutput>["message"];
} {
  const diagnostics = plan.summarize?.(output);
  const aggregate = assembleAggregateTrace({
    phase: plan.phase,
    sessionId: ctx.sessionId,
    tradeId: ctx.tradeId,
    cycleId: ctx.cycleId,
    providerKey: workerTraces[0]?.run.provider_key ?? "unknown",
    modelId: workerTraces[0]?.run.model ?? "unknown",
    strategyContext: ctx.strategyContext,
    schedulingMode: plan.stages.length > 1 ? "dependency_graph" : "flat_parallel",
    maxConcurrency: Math.max(...plan.stages.map((stage) => stage.concurrency), 1),
    output,
    outputSchemaName: plan.outputSchemaName ?? plan.phase,
    marketSnapshotJson:
      diagnostics && Object.keys(diagnostics).length > 0
        ? JSON.stringify(diagnostics)
        : undefined,
    workers: workerTraces,
  });
  return { run: aggregate.run, message: aggregate.message };
}

function formatRejectedReasons(reasons: string[]): string {
  if (reasons.length === 0) return "";
  return ` Rejections: ${reasons.slice(0, 3).join(" | ")}`;
}

function formatRejectionReason(reason: unknown): string {
  if (reason instanceof Error) return reason.message;
  return String(reason);
}

