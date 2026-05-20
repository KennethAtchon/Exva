import { AppError } from "@electron/shared/infra/errors";
import type { AgentResult } from "../../ai-runtime/ai-runtime-types";
import type { WorkerDefinition } from "@electron/shared/ai/pipeline-phase";
import { resolveSessionInstrumentClasses } from "../../../session/effective-instrument-classes";
import { getCachePolicy } from "./cache-policy-registry";
import { buildCompositeInput } from "./input-builder-registry";
import type { PhasePlanServices } from "./phase-plan-services";
import type { PhasePlan, PhasePlanRunContext, PhasePlanRunResult, PhasePlanWorkerTrace } from "./types";
import type { PipelineWorkerRunner } from "../core/types";
import type { ToolBuildContext } from "../context/tool-factory-registry";
import type { SessionStrategyContext } from "@electron/shared/domain";
import type { WorkspaceSession } from "@/lib/types";

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
  async run<TOutput>(input: PhasePlanInterpreterRunInput): Promise<PhasePlanRunResult<TOutput>> {
    const instrumentClasses = resolveSessionInstrumentClasses(input.session, input.services);
    const ctx: PhasePlanRunContext = {
      phase: input.plan.phase,
      sessionId: input.sessionId,
      cycleId: input.cycleId,
      tradeId: input.tradeId,
      session: input.session,
      instrumentClasses,
      strategyContext: input.strategyContext,
      toolContext: input.toolContext,
      services: input.services,
      runner: input.runner,
      input: { ...input.input },
    };

    if (input.plan.cachePolicyId) {
      const policy = getCachePolicy(input.plan.cachePolicyId);
      const fingerprint = policy.fingerprint(ctx);
      const cached = policy.read(ctx, fingerprint);
      if (cached) {
        return {
          output: cached as TOutput,
          source: "cache",
          instrumentClasses,
        };
      }
    }

    for (const entryMode of input.plan.entryModes) {
      if (!entryMode.matches(ctx)) continue;
      const output = await entryMode.resolveOutput(ctx);
      return {
        output: (input.plan.filterOutput?.(output as never, ctx) ?? output) as TOutput,
        source: entryMode.id === "manual_shortlist" ? "manual_shortlist" : "phase",
        instrumentClasses,
      };
    }

    if (input.plan.inputBuilderIds?.length) {
      ctx.input.selectionInstructions = await buildCompositeInput(input.plan.inputBuilderIds, {
        sessionId: ctx.sessionId,
        session: ctx.session,
        instrumentClasses,
        toolContext: ctx.toolContext,
        services: ctx.services,
      });
    }

    let state = await input.plan.initialState(ctx);
    const workerTraces: PhasePlanWorkerTrace[] = [];

    for (const stage of input.plan.stages) {
      const workers = stage.resolveWorkers(ctx, state);
      if (workers.length === 0) continue;

      const settled = await ctx.runner.executeGroup(
        workers.map((worker) => () =>
          ctx.runner.execute<unknown>(worker, stage.buildTask(ctx, state, worker)).then((result) => ({ worker, result })),
        ),
        stage.concurrency,
      );

      const results = settled
        .filter(
          (entry): entry is PromiseFulfilledResult<{ worker: WorkerDefinition; result: AgentResult<unknown> }> =>
            entry.status === "fulfilled",
        )
        .map((entry) => entry.value);

      if (stage.minSuccessfulWorkers != null && results.length < stage.minSuccessfulWorkers) {
        throw new AppError(
          `Stage '${stage.id}' in phase '${input.plan.phase}' produced insufficient successful workers (${results.length}/${stage.minSuccessfulWorkers}).`,
          "VALIDATION_FAILED",
        );
      }

      if (!stage.toleratePartialFailure && results.length !== workers.length) {
        throw new AppError(`Stage '${stage.id}' in phase '${input.plan.phase}' failed worker execution.`, "VALIDATION_FAILED");
      }

      for (const { worker, result } of results) {
        workerTraces.push({
          workerId: worker.id,
          frontier: stage.frontier,
          dependsOn: stage.frontier === 0 ? [] : workerTraces.filter((trace) => trace.frontier === 0).map((trace) => trace.workerId),
          requiredForPhase: stage.frontier === 0,
          run: result.run,
          message: result.message,
        });
      }

      state = stage.applyResults(ctx, state, results);
    }

    const finalized = await input.plan.finalize(ctx, state, workerTraces);
    const output = (input.plan.filterOutput?.(finalized.output, ctx) ?? finalized.output) as TOutput;
    const aggregate = finalized.aggregate;

    if (aggregate) {
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
      message: aggregate?.message as AgentResult<TOutput>["message"] | undefined,
      instrumentClasses,
    };
  }
}

function hasNonEmptyOutput(output: unknown): boolean {
  if (!output || typeof output !== "object") return false;
  const instruments = (output as { instruments?: unknown[] }).instruments;
  return Array.isArray(instruments) && instruments.length > 0;
}
