import { AppError } from "@electron/shared/infra/errors";
import type { AgentResult } from "../../llm/ai-runtime-types";
import type { WorkerDefinition } from "@electron/shared/ai/pipeline-phase";
import { resolveSessionInstrumentClasses } from "../../session/effective-instrument-classes";
import { getCachePolicy } from "../implementations/registry/cache-policy-registry";
import { buildCompositeInput } from "../implementations/registry/input-builder-registry";
import type { PhasePlanServices } from "./services";
import type {
  PhasePlan,
  PhasePlanRunContext,
  PhasePlanRunResult,
  PhasePlanWorkerTrace,
} from "./types";
import type { PipelineWorkerRunner } from "../core/types";
import type { ToolBuildContext } from "../worker-tools/tool-factory-registry";
import type { SessionStrategyContext } from "@electron/shared/domain";
import type { WorkspaceSession } from "@/lib/types";
import { createLogger } from "../../infra/log";

const logger = createLogger("pipeline-runtime");

export interface PhasePlanInterpreterRunInput {
  plan: PhasePlan<unknown, unknown>;
  sessionId: string;
  cycleId: string | null;
  tradeId: string | null;
  input: Record<string, unknown>;
  session: WorkspaceSession;
  strategyContext: SessionStrategyContext;
  toolContext: ToolBuildContext;
  services: PhasePlanServices;
  runner: PipelineWorkerRunner;
}

export class PhasePlanInterpreter {
  async run<TOutput>(
    input: PhasePlanInterpreterRunInput,
  ): Promise<PhasePlanRunResult<TOutput>> {
    const phaseStartedAt = Date.now();
    logger.info(
      {
        sessionId: input.sessionId,
        phase: input.plan.phase,
        cycleId: input.cycleId,
        tradeId: input.tradeId,
        stageCount: input.plan.stages.length,
        inputKeys: Object.keys(input.input).sort(),
        cachePolicyId: input.plan.cachePolicyId ?? null,
        entryModeCount: input.plan.entryModes.length,
      },
      "phase plan start",
    );

    const instrumentClasses = resolveSessionInstrumentClasses(
      input.session,
      input.services,
    );
    const toolContext: ToolBuildContext = {
      ...input.toolContext,
      instrumentClasses,
    };
    const ctx: PhasePlanRunContext = {
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

    if (input.plan.cachePolicyId) {
      const policy = getCachePolicy(input.plan.cachePolicyId);
      const fingerprint = policy.fingerprint(ctx);
      const cached = policy.read(ctx, fingerprint);
      if (cached) {
        logger.info(
          {
            sessionId: input.sessionId,
            phase: input.plan.phase,
            cycleId: input.cycleId,
            cachePolicyId: input.plan.cachePolicyId,
            fingerprint,
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

    for (const entryMode of input.plan.entryModes) {
      if (!entryMode.matches(ctx)) continue;
      logger.info(
        {
          sessionId: input.sessionId,
          phase: input.plan.phase,
          cycleId: input.cycleId,
          entryModeId: entryMode.id,
        },
        "phase plan entry mode matched",
      );
      const output = await entryMode.resolveOutput(ctx);
      return {
        output: (input.plan.filterOutput?.(output as never, ctx) ??
          output) as TOutput,
        source:
          entryMode.id === "manual_shortlist" ? "manual_shortlist" : "phase",
        instrumentClasses,
      };
    }

    if (input.plan.inputBuilderIds?.length) {
      ctx.input.selectionInstructions = await buildCompositeInput(
        input.plan.inputBuilderIds,
        {
          sessionId: ctx.sessionId,
          session: ctx.session,
          instrumentClasses,
          toolContext: ctx.toolContext,
          services: ctx.services,
        },
      );
    }

    let state = await input.plan.initialState(ctx);
    const workerTraces: PhasePlanWorkerTrace[] = [];

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
            result: AgentResult<unknown>;
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

    const finalized = await input.plan.finalize(ctx, state, workerTraces);
    const output = (input.plan.filterOutput?.(finalized.output, ctx) ??
      finalized.output) as TOutput;
    const aggregate = finalized.aggregate;

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
        ...summarizeSelectorDiagnostics(output),
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

    if (input.plan.cachePolicyId && aggregate && hasNonEmptyOutput(output)) {
      const policy = getCachePolicy(input.plan.cachePolicyId);
      const fingerprint = policy.fingerprint(ctx);
      policy.write(ctx, fingerprint, output, {
        agentRunId: aggregate.run.id,
        cycleId: ctx.cycleId ?? ctx.sessionId,
      });
    }

    return {
      output,
      source: "ai_picker",
      run: aggregate?.run as AgentResult<TOutput>["run"] | undefined,
      message: aggregate?.message as
        | AgentResult<TOutput>["message"]
        | undefined,
      instrumentClasses,
    };
  }
}

function hasNonEmptyOutput(output: unknown): boolean {
  if (!output || typeof output !== "object") return false;
  const instruments = (output as { instruments?: unknown[] }).instruments;
  return Array.isArray(instruments) && instruments.length > 0;
}

function formatRejectedReasons(reasons: string[]): string {
  if (reasons.length === 0) return "";
  return ` Rejections: ${reasons.slice(0, 3).join(" | ")}`;
}

function formatRejectionReason(reason: unknown): string {
  if (reason instanceof Error) return reason.message;
  return String(reason);
}

function summarizeSelectorDiagnostics(output: unknown): Record<string, unknown> {
  if (!output || typeof output !== "object") return {};
  const diagnostics = (output as { diagnostics?: unknown }).diagnostics;
  if (!diagnostics || typeof diagnostics !== "object") return {};
  const row = diagnostics as {
    acceptedCount?: number;
    rejected?: Array<{ symbol?: string; reasons?: string[] }>;
  };
  return {
    acceptedCount: row.acceptedCount ?? null,
    rejectedCount: row.rejected?.length ?? null,
    rejectionReasons:
      row.rejected?.map((entry) => ({
        symbol: entry.symbol ?? null,
        reasons: entry.reasons ?? [],
      })) ?? null,
  };
}
