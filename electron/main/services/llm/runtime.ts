import type { PipelinePhase } from "@electron/shared/ai/ai-phase";
import { AppError } from "@electron/shared/infra/errors";
import type { ProviderRegistry } from "./provider-registry";
import type { SearchRegistry } from "../search";
import type { SessionRepo } from "../../db/repositories/sessions/session-repo";
import type { WorkspacePreferencesRepo } from "../../db/repositories/workspace/workspace-prefs-repo";
import type { ApiCallLogRepo } from "../../db/repositories/system/api-call-log-repo";
import type { AgentRunsRepo } from "../../db/repositories/agents/agent-runs-repo";
import type { BrokerRoutingService } from "../broker/broker-routing-service";
import type { BrokerRegistry } from "../broker/broker-registry";
import type { SessionStrategyContextService } from "../session/session-strategy-context-service";
import { PipelineRuntime } from "../pipeline/core/pipeline-runtime";
import { AIPhaseConfigResolver } from "../pipeline/ai-phase-config-resolver";
import type { AIPhaseResult } from "../pipeline/phases/types";
import type { AIPhaseServices } from "../pipeline/phases/services";
import type { InstrumentAnalysisServices } from "../pipeline/analysis/services";
import type {
  AnalysisStepRunner,
  TradeCycleInstrument,
  InstrumentAnalysisState,
  InstrumentAnalysisResult,
} from "../pipeline/analysis/types";
import type { InstrumentClass } from "@/lib/types";
import type { EffectivePipelineConfig } from "@electron/shared/ai/effective-ai-phase-config";

export class LLMRuntime {
  private readonly pipelineRuntime: PipelineRuntime;

  constructor(
    registry: ProviderRegistry,
    searchRegistry: SearchRegistry,
    aiPhaseConfigSource: SessionStrategyContextService,
    sessionRepo: SessionRepo,
    workspacePrefsRepo: WorkspacePreferencesRepo,
    apiCallLogRepo: ApiCallLogRepo,
    agentRunsRepo: AgentRunsRepo,
    brokerRouting?: BrokerRoutingService,
    brokerRegistry?: BrokerRegistry,
    strategyContextService?: SessionStrategyContextService,
    planServices?:
      | (Omit<AIPhaseServices, "strategyContextService" | "brokerRouting"> & {
          brokerRouting?: BrokerRoutingService;
        })
      | null,
    cyclePlanServices?:
      | (Omit<
          InstrumentAnalysisServices,
          "strategyContextService" | "brokerRouting"
        > & {
          brokerRouting?: BrokerRoutingService;
        })
      | null,
  ) {
    this.pipelineRuntime = new PipelineRuntime({
      providerRegistry: registry,
      phaseConfigResolver: new AIPhaseConfigResolver(aiPhaseConfigSource),
      strategyContextService: strategyContextService ?? null,
      sessionRepo,
      workspacePrefsRepo,
      apiCallLogRepo,
      agentRunsRepo,
      searchRegistry,
      brokerRouting,
      brokerRegistry,
    });

    if (
      brokerRouting &&
      strategyContextService &&
      planServices?.brokerRouting
    ) {
      this.pipelineRuntime.setPlanServices({
        ...planServices,
        brokerRouting: planServices.brokerRouting,
        strategyContextService,
      });
    }

    if (
      brokerRouting &&
      strategyContextService &&
      cyclePlanServices?.brokerRouting
    ) {
      this.pipelineRuntime.setInstrumentAnalysisServices({
        ...cyclePlanServices,
        brokerRouting: cyclePlanServices.brokerRouting,
        strategyContextService,
      });
    }
  }

  setStrategyContextService(
    strategyContextService: SessionStrategyContextService,
  ): void {
    this.pipelineRuntime.setStrategyContextService(strategyContextService);
  }

  setWorkerProgressEmitter(
    emitter:
      | import("../pipeline/phases/interpreter").AIPhaseWorkerProgressEmitter
      | undefined,
  ): void {
    this.pipelineRuntime.setWorkerProgressEmitter(emitter);
  }

  setExperienceCapitalAllocator(
    experienceCapitalAllocator: import("../risk/experience-capital-allocator").ExperienceCapitalAllocator,
  ): void {
    this.pipelineRuntime.mergeCyclePlanServices({ experienceCapitalAllocator });
  }

  resolveEffectivePipelineConfig(
    sessionId: string,
    pipelineId?: string,
  ): EffectivePipelineConfig {
    return this.pipelineRuntime.resolveEffectiveConfig(sessionId, pipelineId);
  }

  assertValidEffectivePipelineConfig(
    sessionId: string,
    pipelineId?: string,
  ): EffectivePipelineConfig {
    return this.pipelineRuntime.assertValidEffectiveConfig(
      sessionId,
      pipelineId,
    );
  }

  async runAIPhase<TOutput>(
    phase: PipelinePhase,
    sessionId: string,
    cycleId: string,
    input: Record<string, unknown> = {},
  ): Promise<AIPhaseResult<TOutput>> {
    if (!sessionId)
      throw new AppError(
        "Session id is required for phase plan execution",
        "VALIDATION_FAILED",
      );
    return this.pipelineRuntime.runAIPhase<TOutput>({
      phase,
      sessionId,
      input,
      cycleId,
    });
  }

  async runCycle(
    cyclePlanId: string,
    opts: {
      sessionId: string;
      cycleId: string;
      tradeId?: string | null;
      instrument: TradeCycleInstrument;
      instrumentClasses: InstrumentClass[];
      seedState?: Partial<InstrumentAnalysisState>;
      runStep?: AnalysisStepRunner;
      lastStageId?: string;
    },
  ): Promise<InstrumentAnalysisResult> {
    if (!opts.sessionId)
      throw new AppError(
        "Session id is required for cycle execution",
        "VALIDATION_FAILED",
      );
    return this.pipelineRuntime.runCycle(cyclePlanId, opts);
  }

  async runPlan(
    planId: string,
    opts: {
      sessionId: string;
      cycleId: string;
      tradeId?: string | null;
      instrument?: TradeCycleInstrument;
      instrumentClasses?: InstrumentClass[];
      input?: Record<string, unknown>;
      seedState?: Partial<InstrumentAnalysisState>;
      runStep?: AnalysisStepRunner;
      lastStageId?: string;
    },
  ): Promise<InstrumentAnalysisResult | AIPhaseResult<unknown>> {
    if (!opts.sessionId)
      throw new AppError(
        "Session id is required for plan execution",
        "VALIDATION_FAILED",
      );
    return this.pipelineRuntime.runPlan(planId, opts);
  }
}
