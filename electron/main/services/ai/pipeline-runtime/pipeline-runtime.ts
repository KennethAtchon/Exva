import type { PrepareStepFunction, ToolSet } from "ai";
import { AppError } from "@electron/shared/infra/errors";
import type { PipelinePhase } from "@electron/shared/ai/pipeline-phase";
import type { AgentResult } from "../ai-runtime/ai-runtime-types";
import { getPipelineDefinition } from "./pipeline-registry";
import { executeWorker, type WorkerExecutorDeps } from "./worker-executor";
import type { PhaseConfigResolver } from "./phase-config-resolver";
import type { ProviderRegistry } from "../provider-registry";
import type { PromptAssetLoader } from "../prompt-asset-loader";
import type { ToolBuildContext } from "./tool-factory-registry";
import type { SessionStrategyContextService } from "../../session/session-strategy-context-service";

export interface PipelineRuntimeDeps {
  providerRegistry: ProviderRegistry;
  phaseConfigResolver: PhaseConfigResolver;
  promptLoader: PromptAssetLoader;
  strategyContextService: SessionStrategyContextService;
}

export interface RunPhaseOptions<TInput = Record<string, unknown>> {
  phase: PipelinePhase;
  sessionId: string;
  input: TInput;
  cycleId?: string | null;
  tradeId?: string | null;
  toolContext: ToolBuildContext;
  prepareStep?: PrepareStepFunction<ToolSet>;
  terminalToolNames?: readonly string[];
}

export class PipelineRuntime {
  constructor(private readonly deps: PipelineRuntimeDeps) {}

  async run<TInput, TOutput>(opts: RunPhaseOptions<TInput>): Promise<AgentResult<TOutput>> {
    const definition = getPipelineDefinition(opts.phase);
    const workers = definition.workers;

    if (workers.length === 0) {
      throw new AppError(`Phase ${opts.phase} has no workers defined`, "VALIDATION_FAILED");
    }

    const strategyContext = this.deps.strategyContextService.get(opts.sessionId);

    const executorDeps: WorkerExecutorDeps = {
      providerRegistry: this.deps.providerRegistry,
      phaseConfigResolver: this.deps.phaseConfigResolver,
      promptLoader: this.deps.promptLoader,
      toolContext: opts.toolContext,
      strategyContext,
    };

    // Phase 1: single-worker phases — execute first worker
    const worker = workers[0]!;

    const task = opts.input as Record<string, unknown>;

    const terminalToolNames = opts.terminalToolNames ?? definition.terminalToolNames;

    const result = await executeWorker<TOutput>(executorDeps, {
      phase: opts.phase,
      worker,
      sessionId: opts.sessionId,
      cycleId: opts.cycleId ?? null,
      tradeId: opts.tradeId ?? null,
      task,
      terminalToolNames,
      prepareStep: opts.prepareStep,
    });

    return result;
  }
}
