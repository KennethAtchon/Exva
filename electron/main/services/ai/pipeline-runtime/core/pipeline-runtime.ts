import type { PrepareStepFunction, ToolSet } from "ai";
import { AppError } from "@electron/shared/infra/errors";
import type { PipelinePhase } from "@electron/shared/ai/pipeline-phase";
import type { AgentResult } from "../../ai-runtime/ai-runtime-types";
import { getPipelineDefinition } from "./pipeline-registry";
import { executeWorker, type WorkerExecutorDeps } from "../execution/worker-executor";
import type { PhaseConfigResolver } from "../phase-config-resolver";
import type { ProviderRegistry } from "../../provider-registry";
import type { PromptAssetLoader } from "../../prompt-asset-loader";
import type { ToolBuildContext } from "../context/tool-factory-registry";
import type { SessionStrategyContextService } from "../../../session/session-strategy-context-service";
import type { SessionRepo } from "../../../../db/repositories/sessions/session-repo";
import type { WorkspacePreferencesRepo } from "../../../../db/repositories/workspace/workspace-prefs-repo";
import type { ApiCallLogRepo } from "../../../../db/repositories/system/api-call-log-repo";
import type { SearchRegistry } from "../../search";
import type { BrokerRoutingService } from "../../../broker/broker-routing-service";
import type { BrokerRegistry } from "../../../broker/broker-registry";
import { buildToolContext } from "../context/tool-context-builder";

export interface PipelineRuntimeDeps {
  providerRegistry: ProviderRegistry;
  phaseConfigResolver: PhaseConfigResolver;
  promptLoader: PromptAssetLoader;
  strategyContextService: SessionStrategyContextService | null;
  sessionRepo: SessionRepo;
  workspacePrefsRepo: WorkspacePreferencesRepo;
  apiCallLogRepo: ApiCallLogRepo;
  searchRegistry: SearchRegistry;
  brokerRouting?: BrokerRoutingService;
  brokerRegistry?: BrokerRegistry;
}

export interface RunPhaseOptions<TInput = Record<string, unknown>> {
  phase: PipelinePhase;
  sessionId: string;
  input: TInput;
  cycleId?: string | null;
  tradeId?: string | null;
  toolContext?: ToolBuildContext;
  prepareStep?: PrepareStepFunction<ToolSet>;
  terminalToolNames?: readonly string[];
}

export class PipelineRuntime {
  constructor(private readonly deps: PipelineRuntimeDeps) {}

  setStrategyContextService(strategyContextService: SessionStrategyContextService): void {
    this.deps.strategyContextService = strategyContextService;
  }

  async run<TInput, TOutput>(opts: RunPhaseOptions<TInput>): Promise<AgentResult<TOutput>> {
    if (!opts.sessionId) {
      throw new AppError("Session id is required for phase execution", "VALIDATION_FAILED");
    }

    const definition = getPipelineDefinition(opts.phase);
    const workers = definition.workers;

    if (workers.length === 0) {
      throw new AppError(`Phase ${opts.phase} has no workers defined`, "VALIDATION_FAILED");
    }

    const strategyContext = this.requireStrategyContextService().get(opts.sessionId);
    const toolContext = opts.toolContext ?? await buildToolContext(this.deps, {
      sessionId: opts.sessionId,
      cycleId: opts.cycleId,
      tradeId: opts.tradeId,
      strategyContext,
    });

    const executorDeps: WorkerExecutorDeps = {
      providerRegistry: this.deps.providerRegistry,
      phaseConfigResolver: this.deps.phaseConfigResolver,
      promptLoader: this.deps.promptLoader,
      toolContext,
      strategyContext,
    };

    // Phase 1: single-worker phases — execute first worker
    const worker = workers[0]!;

    const task = opts.input as Record<string, unknown>;

    const terminalToolNames = opts.terminalToolNames ?? definition.terminalToolNames;
    const prepareStep = opts.prepareStep ?? definition.buildPrepareStep?.(toolContext);

    const result = await executeWorker<TOutput>(executorDeps, {
      phase: opts.phase,
      worker,
      sessionId: opts.sessionId,
      cycleId: opts.cycleId ?? null,
      tradeId: opts.tradeId ?? null,
      task,
      terminalToolNames,
      prepareStep,
    });

    return result;
  }

  private requireStrategyContextService(): SessionStrategyContextService {
    if (!this.deps.strategyContextService) {
      throw new AppError("Strategy context service is not configured.", "UNKNOWN");
    }
    return this.deps.strategyContextService;
  }
}
