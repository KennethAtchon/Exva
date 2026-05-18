import type { PrepareStepFunction, ToolSet } from "ai";
import { AppError } from "@electron/shared/infra/errors";
import type { PipelinePhase } from "@electron/shared/ai/pipeline-phase";
import type { AgentResult } from "../../ai-runtime/ai-runtime-types";
import { getPipelineDefinition } from "./pipeline-registry";
import { buildWorkerSchedule, executeByFrontier } from "./worker-graph-scheduler";
import { executeWorker, type WorkerExecutorDeps } from "../execution/worker-executor";
import { assembleAggregateTrace } from "../execution/trace-assembler";
import { SelectorPipeline } from "../../selector-pipeline/selector-pipeline";
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

    if (opts.phase === "selector") {
      const selectorPipeline = new SelectorPipeline({
        providerRegistry: this.deps.providerRegistry,
        phaseConfigResolver: this.deps.phaseConfigResolver,
        promptLoader: this.deps.promptLoader,
      });
      return selectorPipeline.run({
        sessionId: opts.sessionId,
        cycleId: opts.cycleId ?? null,
        tradeId: opts.tradeId ?? null,
        selectionInstructions: String((opts.input as Record<string, unknown>).selectionInstructions ?? ""),
        toolContext,
        strategyContext,
      }) as Promise<AgentResult<TOutput>>;
    }

    const task = opts.input as Record<string, unknown>;
    const terminalToolNames = opts.terminalToolNames ?? definition.terminalToolNames;
    const prepareStep = opts.prepareStep ?? definition.buildPrepareStep?.(toolContext);

    const schedule = buildWorkerSchedule(workers as never, definition.scheduling);
    const executed = await executeByFrontier(schedule.ordered, schedule.maxConcurrency, async ({ worker }) =>
      executeWorker<unknown>(executorDeps, {
        phase: opts.phase,
        worker,
        sessionId: opts.sessionId,
        cycleId: opts.cycleId ?? null,
        tradeId: opts.tradeId ?? null,
        task,
        terminalToolNames,
        prepareStep,
      }),
    );

    const output = aggregatePhaseOutput(definition, executed.map((entry) => entry.result.output)) as TOutput;
    const phaseExecConfig = this.deps.phaseConfigResolver.resolvePhaseConfig(opts.sessionId, opts.phase);
    const aggregate = assembleAggregateTrace({
      phase: opts.phase,
      sessionId: opts.sessionId,
      tradeId: opts.tradeId ?? null,
      cycleId: opts.cycleId ?? null,
      providerKey: phaseExecConfig.providerKey || executed[0]?.result.run.provider_key || "unknown",
      modelId: phaseExecConfig.modelId || executed[0]?.result.run.model || "unknown",
      strategyContext,
      schedulingMode: schedule.schedulingMode,
      maxConcurrency: schedule.maxConcurrency,
      output,
      outputSchemaName: definition.persistence.outputSchemaName,
      workers: executed.map(({ node, result }) => ({
        workerId: node.worker.id,
        frontier: node.frontier,
        dependsOn: [...(node.worker.dependsOn ?? [])],
        requiredForPhase: node.worker.requiredForPhase ?? true,
        run: result.run,
        message: result.message,
      })),
    });

    return { run: aggregate.run, message: aggregate.message, output };
  }

  private requireStrategyContextService(): SessionStrategyContextService {
    if (!this.deps.strategyContextService) {
      throw new AppError("Strategy context service is not configured.", "UNKNOWN");
    }
    return this.deps.strategyContextService;
  }
}

function aggregatePhaseOutput(definition: { aggregate?: unknown; outputMode: string }, outputs: unknown[]): unknown {
  if (typeof definition.aggregate === "function") {
    return definition.aggregate(outputs as never);
  }
  if (outputs.length === 1) return outputs[0] ?? null;
  if (definition.outputMode === "text") return outputs.join("\n\n");
  return outputs.reduce<Record<string, unknown>>((acc, output) => {
    if (output && typeof output === "object") Object.assign(acc, output);
    return acc;
  }, {});
}
