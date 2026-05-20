import type { PipelinePhase } from "@electron/shared/ai/pipeline-phase";
import { AppError } from "@electron/shared/infra/errors";
import type { ProviderRegistry } from "../provider-registry";
import type { SearchRegistry } from "../search";
import type { PromptAssetLoader } from "../prompt-asset-loader";
import type { SessionAiPhasesRepo } from "../../../db/repositories/sessions/session-ai-phases-repo";
import type { SessionRepo } from "../../../db/repositories/sessions/session-repo";
import type { WorkspacePreferencesRepo } from "../../../db/repositories/workspace/workspace-prefs-repo";
import type { ApiCallLogRepo } from "../../../db/repositories/system/api-call-log-repo";
import type { AgentRunsRepo } from "../../../db/repositories/agents/agent-runs-repo";
import type { AgentMessagesRepo } from "../../../db/repositories/agents/agent-messages-repo";
import type { InstrumentCacheRepo } from "../../../db/repositories/market/instrument-cache-repo";
import type { SessionSelectorSettingsRepo } from "../../../db/repositories/sessions/session-selector-settings-repo";
import type { SessionBrokerAssignmentsRepo } from "../../../db/repositories/sessions/session-broker-assignments-repo";
import type { BrokerAccountsRepo } from "../../../db/repositories/brokers/broker-accounts-repo";
import type { BrokerRoutingService } from "../../broker/broker-routing-service";
import type { BrokerRegistry } from "../../broker/broker-registry";
import type { SessionStrategyContextService } from "../../session/session-strategy-context-service";
import { PipelineRuntime } from "../pipeline-runtime/core/pipeline-runtime";
import { PhaseConfigResolver } from "../pipeline-runtime/phase-config-resolver";
import type { PhasePlanRunResult } from "../pipeline-runtime/plan/phase/types";
import type { PhasePlanServices } from "../pipeline-runtime/plan/phase/services";
import type { CyclePlanServices } from "../pipeline-runtime/plan/cycle/services";
import type {
  CycleStepRunner,
  TradeCycleInstrument,
  TradeCyclePlanState,
  TradePipelineResult,
} from "../pipeline-runtime/plan/cycle/types";
import type { SessionConfig, InstrumentClass } from "@/lib/types";
import type { EffectivePipelineConfig } from "@electron/shared/ai/effective-pipeline-config";

export class AiRuntime {
  private readonly pipelineRuntime: PipelineRuntime;

  constructor(
    registry: ProviderRegistry,
    searchRegistry: SearchRegistry,
    promptLoader: PromptAssetLoader,
    aiPhasesRepo: SessionAiPhasesRepo,
    sessionRepo: SessionRepo,
    workspacePrefsRepo: WorkspacePreferencesRepo,
    apiCallLogRepo: ApiCallLogRepo,
    agentRunsRepo: AgentRunsRepo,
    brokerRouting?: BrokerRoutingService,
    brokerRegistry?: BrokerRegistry,
    strategyContextService?: SessionStrategyContextService,
    planServices?:
      | (Omit<PhasePlanServices, "strategyContextService" | "brokerRouting"> & {
          brokerRouting?: BrokerRoutingService;
        })
      | null,
    cyclePlanServices?:
      | (Omit<CyclePlanServices, "strategyContextService" | "brokerRouting"> & {
          brokerRouting?: BrokerRoutingService;
        })
      | null,
  ) {
    this.pipelineRuntime = new PipelineRuntime({
      providerRegistry: registry,
      phaseConfigResolver: new PhaseConfigResolver(aiPhasesRepo),
      promptLoader,
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
      this.pipelineRuntime.setCyclePlanServices({
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

  async runPhasePlan<TOutput>(
    phase: PipelinePhase,
    sessionId: string,
    cycleId: string,
    input: Record<string, unknown> = {},
  ): Promise<PhasePlanRunResult<TOutput>> {
    if (!sessionId)
      throw new AppError(
        "Session id is required for phase plan execution",
        "VALIDATION_FAILED",
      );
    return this.pipelineRuntime.runPhasePlan<TOutput>({
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
      sessionConfig: SessionConfig;
      instrumentClasses: InstrumentClass[];
      seedState?: Partial<TradeCyclePlanState>;
      runStep?: CycleStepRunner;
      lastStageId?: string;
    },
  ): Promise<TradePipelineResult> {
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
      sessionConfig?: SessionConfig;
      instrumentClasses?: InstrumentClass[];
      input?: Record<string, unknown>;
      seedState?: Partial<TradeCyclePlanState>;
      runStep?: CycleStepRunner;
      lastStageId?: string;
    },
  ): Promise<TradePipelineResult | PhasePlanRunResult<unknown>> {
    if (!opts.sessionId)
      throw new AppError(
        "Session id is required for plan execution",
        "VALIDATION_FAILED",
      );
    return this.pipelineRuntime.runPlan(planId, opts);
  }
}
