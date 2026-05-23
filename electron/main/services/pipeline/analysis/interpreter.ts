import { AppError } from "@electron/shared/infra/errors";
import {
  CyclePausedError,
  CycleStageFailedError,
  type CyclePlan,
  type CyclePlanRunContext,
  type CycleStepRunner,
  type TradeCyclePlanState,
  type TradePipelineResult,
} from "./types";
import type { CyclePlanServices } from "./services";
import { createLogger } from "../../infra/log";

const logger = createLogger("pipeline-runtime");

export interface CyclePlanInterpreterRunInput {
  plan: CyclePlan<TradeCyclePlanState>;
  sessionId: string;
  cycleId: string;
  tradeId: string | null;
  instrument: CyclePlanRunContext["instrument"];
  sessionConfig: CyclePlanRunContext["sessionConfig"];
  instrumentClasses: CyclePlanRunContext["instrumentClasses"];
  session: CyclePlanRunContext["session"];
  strategyContext: CyclePlanRunContext["strategyContext"];
  toolContext: CyclePlanRunContext["toolContext"];
  services: CyclePlanServices;
  runPhasePlan: CyclePlanRunContext["runPhasePlan"];
  runStep?: CycleStepRunner;
  seedState?: Partial<TradeCyclePlanState>;
  lastStageId?: string;
}

export class CyclePlanInterpreter {
  async run(input: CyclePlanInterpreterRunInput): Promise<TradePipelineResult> {
    const cycleStartedAt = Date.now();
    logger.info(
      {
        sessionId: input.sessionId,
        cycleId: input.cycleId,
        cyclePlanId: input.plan.id,
        tradeId: input.tradeId,
        instrumentSymbol: input.instrument.symbol,
        instrumentClass: input.instrument.instrumentClass,
        stageCount: input.plan.stages.length,
        lastStageId: input.lastStageId ?? null,
      },
      "cycle plan start",
    );

    const ctx: CyclePlanRunContext = {
      cyclePlanId: input.plan.id,
      sessionId: input.sessionId,
      cycleId: input.cycleId,
      tradeId: input.tradeId,
      session: input.session,
      instrument: input.instrument,
      sessionConfig: input.sessionConfig,
      instrumentClasses: input.instrumentClasses,
      strategyContext: input.strategyContext,
      toolContext: input.toolContext,
      services: input.services,
      runPhasePlan: input.runPhasePlan,
    };

    let state = input.plan.initialState(ctx, input.seedState);

    for (const stage of input.plan.stages) {
      const stageStartedAt = Date.now();
      logger.info(
        {
          sessionId: input.sessionId,
          cycleId: input.cycleId,
          cyclePlanId: input.plan.id,
          stageId: stage.id,
          executionStage: stage.executionStage ?? null,
          required: stage.required,
        },
        "cycle stage start",
      );

      const execute = () => stage.execute(ctx, state);

      try {
        if (stage.executionStage && input.runStep) {
          state = (await input.runStep(
            stage.executionStage,
            execute,
          )) as TradeCyclePlanState;
        } else {
          state = await execute();
        }
        logger.info(
          {
            sessionId: input.sessionId,
            cycleId: input.cycleId,
            cyclePlanId: input.plan.id,
            stageId: stage.id,
            durationMs: Date.now() - stageStartedAt,
          },
          "cycle stage complete",
        );
      } catch (error) {
        logger.warn(
          {
            sessionId: input.sessionId,
            cycleId: input.cycleId,
            cyclePlanId: input.plan.id,
            stageId: stage.id,
            required: stage.required,
            durationMs: Date.now() - stageStartedAt,
            error: error instanceof Error ? error.message : String(error),
          },
          "cycle stage failed",
        );
        if (isCycleControlError(error)) throw error;
        if (stage.required) {
          throw error instanceof Error
            ? error
            : new AppError(String(error), "UNKNOWN");
        }
      }

      if (input.lastStageId && stage.id === input.lastStageId) break;
    }

    const totalAiCostUsd = sumAiCost(state);
    logger.info(
      {
        sessionId: input.sessionId,
        cycleId: input.cycleId,
        cyclePlanId: input.plan.id,
        totalAiCostUsd,
        durationMs: Date.now() - cycleStartedAt,
      },
      "cycle plan complete",
    );

    return {
      state,
      totalAiCostUsd,
    };
  }
}

function sumAiCost(state: TradeCyclePlanState): number {
  const runs = Object.values(state).filter(
    (v): v is { run: { cost_usd?: number } } =>
      typeof v === "object" && v !== null && "run" in v,
  );
  return Number(
    runs.reduce((sum, r) => sum + (r.run.cost_usd ?? 0), 0).toFixed(6),
  );
}

function isCycleControlError(
  error: unknown,
): error is CyclePausedError | CycleStageFailedError {
  return (
    error instanceof Error &&
    (error.name === "CyclePausedError" ||
      error.name === "CycleStageFailedError")
  );
}

export { CyclePausedError, CycleStageFailedError } from "./types";
