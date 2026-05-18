import type { PipelinePhase } from "@electron/shared/ai/pipeline-phase";
import { AppError } from "@electron/shared/infra/errors";
import type { AgentResult } from "./ai-runtime-types";
import type { ProviderRegistry } from "../provider-registry";
import type { SearchRegistry } from "../search";
import type { PromptAssetLoader } from "../prompt-asset-loader";
import type { SessionAiPhasesRepo } from "../../../db/repositories/sessions/session-ai-phases-repo";
import type { SessionRepo } from "../../../db/repositories/sessions/session-repo";
import type { WorkspacePreferencesRepo } from "../../../db/repositories/workspace/workspace-prefs-repo";
import type { ApiCallLogRepo } from "../../../db/repositories/system/api-call-log-repo";
import type { BrokerRoutingService } from "../../broker/broker-routing-service";
import type { BrokerRegistry } from "../../broker/broker-registry";
import type { SessionStrategyContextService } from "../../session/session-strategy-context-service";
import { PipelineRuntime } from "../pipeline-runtime/core/pipeline-runtime";
import { PhaseConfigResolver } from "../pipeline-runtime/phase-config-resolver";

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
    brokerRouting?: BrokerRoutingService,
    brokerRegistry?: BrokerRegistry,
    strategyContextService?: SessionStrategyContextService,
  ) {
    this.pipelineRuntime = new PipelineRuntime({
      providerRegistry: registry,
      phaseConfigResolver: new PhaseConfigResolver(aiPhasesRepo),
      promptLoader,
      strategyContextService: strategyContextService ?? null,
      sessionRepo,
      workspacePrefsRepo,
      apiCallLogRepo,
      searchRegistry,
      brokerRouting,
      brokerRegistry,
    });
  }

  setStrategyContextService(strategyContextService: SessionStrategyContextService): void {
    this.pipelineRuntime.setStrategyContextService(strategyContextService);
  }

  async runPhase<TInput, TOutput>(
    phase: PipelinePhase,
    sessionId: string,
    input: TInput,
    cycleId?: string | null,
    tradeId?: string | null,
  ): Promise<AgentResult<TOutput>> {
    if (!sessionId) throw new AppError("Session id is required for phase execution", "VALIDATION_FAILED");

    return this.pipelineRuntime.run<TInput, TOutput>({
      phase,
      sessionId,
      input,
      cycleId,
      tradeId,
    });
  }
}
