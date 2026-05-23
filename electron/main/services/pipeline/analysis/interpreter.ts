import { AppError } from "@electron/shared/infra/errors";
import {
  AnalysisPausedError,
  AnalysisStepFailedError,
  type InstrumentAnalysis,
  type InstrumentAnalysisContext,
  type AnalysisStepRunner,
  type InstrumentAnalysisState,
  type InstrumentAnalysisResult,
} from "./types";
import type { InstrumentAnalysisServices } from "./services";
import { createLogger } from "../../infra/log";

const logger = createLogger("pipeline-runtime");

export interface InstrumentAnalysisRunInput {
  plan: InstrumentAnalysis<InstrumentAnalysisState>;
  sessionId: string;
  cycleId: string;
  tradeId: string | null;
  instrument: InstrumentAnalysisContext["instrument"];
  sessionConfig: InstrumentAnalysisContext["sessionConfig"];
  instrumentClasses: InstrumentAnalysisContext["instrumentClasses"];
  session: InstrumentAnalysisContext["session"];
  strategyContext: InstrumentAnalysisContext["strategyContext"];
  toolContext: InstrumentAnalysisContext["toolContext"];
  services: InstrumentAnalysisServices;
  runAIPhase: InstrumentAnalysisContext["runAIPhase"];
  runStep?: AnalysisStepRunner;
  seedState?: Partial<InstrumentAnalysisState>;
  lastStageId?: string;
}

export class InstrumentAnalysisRunner {
  async run(input: InstrumentAnalysisRunInput): Promise<InstrumentAnalysisResult> {
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

    const ctx: InstrumentAnalysisContext = {
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
      runAIPhase: input.runAIPhase,
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
          )) as InstrumentAnalysisState;
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

function sumAiCost(state: InstrumentAnalysisState): number {
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
): error is AnalysisPausedError | AnalysisStepFailedError {
  return (
    error instanceof Error &&
    (error.name === "AnalysisPausedError" ||
      error.name === "AnalysisStepFailedError")
  );
}

export { AnalysisPausedError, AnalysisStepFailedError } from "./types";
