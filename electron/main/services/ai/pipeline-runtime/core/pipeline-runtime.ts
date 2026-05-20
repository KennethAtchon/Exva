import type { PrepareStepFunction, ToolSet } from "ai";
import { AppError } from "@electron/shared/infra/errors";
import type { PipelinePhase, WorkerDefinition } from "@electron/shared/ai/pipeline-phase";
import type { AgentResult } from "../../ai-runtime/ai-runtime-types";
import { getPipelineDefinition } from "./pipeline-registry";
import { buildWorkerSchedule, executeByFrontier } from "./worker-graph-scheduler";
import { executeWorker, type WorkerExecutorDeps } from "../execution/worker-executor";
import { assembleAggregateTrace } from "../execution/trace-assembler";
import { runConcurrentGroup } from "./concurrent-group-runner";
import type { PipelineRunContext, PipelineWorkerRunner } from "./types";
import type { PhaseConfigResolver } from "../phase-config-resolver";
import type { ProviderRegistry } from "../../provider-registry";
import type { PromptAssetLoader } from "../../prompt-asset-loader";
import type { ToolBuildContext } from "../context/tool-factory-registry";
import type { SessionStrategyContextService } from "../../../session/session-strategy-context-service";
import type { SessionRepo } from "../../../../db/repositories/sessions/session-repo";
import type { WorkspacePreferencesRepo } from "../../../../db/repositories/workspace/workspace-prefs-repo";
import type { ApiCallLogRepo } from "../../../../db/repositories/system/api-call-log-repo";
import type { AgentRunsRepo } from "../../../../db/repositories/agents/agent-runs-repo";
import type { SearchRegistry } from "../../search";
import type { BrokerRoutingService } from "../../../broker/broker-routing-service";
import type { BrokerRegistry } from "../../../broker/broker-registry";
import { buildToolContext } from "../context/tool-context-builder";
import { DEFAULT_PIPELINE_CONFIG } from "@electron/shared/ai/pipeline-config";
import { PipelineSpendTracker } from "../execution/pipeline-spend-tracker";
import { createLogger } from "../../../infra/log";
import type { EffectivePipelineConfig } from "@electron/shared/ai/effective-pipeline-config";
import {
  assertValidEffectivePipelineConfig,
  DEFAULT_PIPELINE_ID,
  resolveEffectivePipelineConfig,
} from "../effective-pipeline-config";
import { PhasePlanInterpreter } from "../plan/phase-plan-interpreter";
import { requirePhasePlan } from "../plan/phase-plan-registry";
import type { PhasePlanServices } from "../plan/phase-plan-services";
import { CyclePlanInterpreter } from "../plan/cycle-plan-interpreter";
import { requireCyclePlan } from "../plan/cycle-plan-registry";
import type { CyclePlanServices } from "../plan/cycle-plan-services";
import type { CycleStepRunner, TradeCycleInstrument, TradeCyclePlanState, TradePipelineResult } from "../plan/cycle-types";
import type { SessionConfig } from "@/lib/types";
import type { InstrumentClass } from "@/lib/types";

const logger = createLogger("pipeline-runtime");

export interface PipelineRuntimeDeps {
  providerRegistry: ProviderRegistry;
  phaseConfigResolver: PhaseConfigResolver;
  promptLoader: PromptAssetLoader;
  strategyContextService: SessionStrategyContextService | null;
  sessionRepo: SessionRepo;
  workspacePrefsRepo: WorkspacePreferencesRepo;
  apiCallLogRepo: ApiCallLogRepo;
  agentRunsRepo: AgentRunsRepo;
  searchRegistry: SearchRegistry;
  brokerRouting?: BrokerRoutingService;
  brokerRegistry?: BrokerRegistry;
  planServices?: PhasePlanServices | null;
  cyclePlanServices?: CyclePlanServices | null;
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
  private readonly cycleSpendUsd = new Map<string, number>();
  private readonly planInterpreter = new PhasePlanInterpreter();
  private readonly cyclePlanInterpreter = new CyclePlanInterpreter();

  constructor(private readonly deps: PipelineRuntimeDeps) {}

  setStrategyContextService(strategyContextService: SessionStrategyContextService): void {
    this.deps.strategyContextService = strategyContextService;
    if (this.deps.planServices) {
      this.deps.planServices.strategyContextService = strategyContextService;
    }
    if (this.deps.cyclePlanServices) {
      this.deps.cyclePlanServices.strategyContextService = strategyContextService;
    }
  }

  setPlanServices(planServices: PhasePlanServices): void {
    this.deps.planServices = planServices;
  }

  setCyclePlanServices(cyclePlanServices: CyclePlanServices): void {
    this.deps.cyclePlanServices = cyclePlanServices;
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
    const plan = requireCyclePlan(cyclePlanId);
    if (!this.deps.cyclePlanServices) {
      throw new AppError(`Cycle plan services are not configured for '${cyclePlanId}'.`, "UNKNOWN");
    }

    const strategyContext = this.requireStrategyContextService().get(opts.sessionId);
    const toolContext = await buildToolContext(this.deps, {
      sessionId: opts.sessionId,
      cycleId: opts.cycleId,
      tradeId: opts.tradeId ?? null,
      strategyContext,
    });
    const session = this.deps.sessionRepo.requireById(opts.sessionId);

    return this.cyclePlanInterpreter.run({
      plan: plan as import("../plan/cycle-types").CyclePlan<TradeCyclePlanState>,
      sessionId: opts.sessionId,
      cycleId: opts.cycleId,
      tradeId: opts.tradeId ?? null,
      instrument: opts.instrument,
      sessionConfig: opts.sessionConfig,
      instrumentClasses: opts.instrumentClasses,
      session,
      strategyContext,
      toolContext,
      services: this.deps.cyclePlanServices,
      seedState: opts.seedState,
      runStep: opts.runStep,
      lastStageId: opts.lastStageId,
      runPhase: (phase, input) =>
        this.run({
          phase,
          sessionId: opts.sessionId,
          input,
          cycleId: opts.cycleId,
          tradeId: opts.tradeId ?? null,
          toolContext,
        }),
    });
  }

  resolveEffectiveConfig(sessionId: string, pipelineId = DEFAULT_PIPELINE_ID): EffectivePipelineConfig {
    const strategyContext = this.requireStrategyContextService().get(sessionId);
    return resolveEffectivePipelineConfig({
      sessionId,
      pipelineId,
      phaseConfigResolver: this.deps.phaseConfigResolver,
      strategyContext,
    });
  }

  assertValidEffectiveConfig(sessionId: string, pipelineId = DEFAULT_PIPELINE_ID): EffectivePipelineConfig {
    const config = this.resolveEffectiveConfig(sessionId, pipelineId);
    assertValidEffectivePipelineConfig(config, { promptLoader: this.deps.promptLoader });
    return config;
  }

  async buildToolContext(
    sessionId: string,
    cycleId: string | null,
    strategyContext = this.requireStrategyContextService().get(sessionId),
    tradeId: string | null = null,
  ): Promise<ToolBuildContext> {
    return buildToolContext(this.deps, {
      sessionId,
      cycleId,
      tradeId,
      strategyContext,
    });
  }

  async runPhasePlan<TOutput>(
    opts: Omit<RunPhaseOptions, "input"> & { input?: Record<string, unknown> },
  ): Promise<import("../plan/types").PhasePlanRunResult<TOutput>> {
    const plan = requirePhasePlan(opts.phase);
    if (!this.deps.planServices) {
      throw new AppError(`Phase plan services are not configured for '${opts.phase}'.`, "UNKNOWN");
    }

    const strategyContext = this.requireStrategyContextService().get(opts.sessionId);
    const cycleKey = opts.cycleId ?? opts.sessionId;
    const spendTracker = new PipelineSpendTracker({
      phaseSpendCapUsd: this.deps.phaseConfigResolver.resolvePhaseSpendCapUsd(opts.phase),
      pipelineSpendCapUsd: DEFAULT_PIPELINE_CONFIG.totalSpendCapUsd,
      sessionSpendCapUsd: strategyContext.riskConfig.maxAiSpendUsd,
      sessionSpentBeforeRunUsd: this.deps.agentRunsRepo.dailyAiSpendUsd(opts.sessionId),
      pipelineSpentBeforePhaseUsd: opts.cycleId ? (this.cycleSpendUsd.get(cycleKey) ?? 0) : 0,
    });

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

    const workerRunBase = {
      phase: opts.phase,
      sessionId: opts.sessionId,
      cycleId: opts.cycleId ?? null,
      tradeId: opts.tradeId ?? null,
      spendTracker,
    };

    const runner: PipelineWorkerRunner = {
      execute: <T>(worker: WorkerDefinition, task: Record<string, unknown>) =>
        executeWorker<T>(executorDeps, { ...workerRunBase, worker, task }),
      executeGroup: (tasks, concurrency) => runConcurrentGroup(tasks, concurrency, () => spendTracker.canContinue()),
      canContinueWorkers: () => spendTracker.canContinue(),
    };

    const session = this.deps.sessionRepo.requireById(opts.sessionId);
    const result = await this.planInterpreter.run<TOutput>({
      plan,
      sessionId: opts.sessionId,
      cycleId: opts.cycleId ?? null,
      tradeId: opts.tradeId ?? null,
      input: opts.input ?? {},
      session,
      strategyContext,
      toolContext,
      services: this.deps.planServices,
      runner,
    });
    this.recordCycleSpend(cycleKey, spendTracker.phaseSpent);
    return result;
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
    const cycleKey = opts.cycleId ?? opts.sessionId;
    const pipelineSpentBeforePhaseUsd = opts.cycleId ? (this.cycleSpendUsd.get(cycleKey) ?? 0) : 0;
    const spendTracker = new PipelineSpendTracker({
      phaseSpendCapUsd: this.deps.phaseConfigResolver.resolvePhaseSpendCapUsd(opts.phase),
      pipelineSpendCapUsd: DEFAULT_PIPELINE_CONFIG.totalSpendCapUsd,
      sessionSpendCapUsd: strategyContext.riskConfig.maxAiSpendUsd,
      sessionSpentBeforeRunUsd: this.deps.agentRunsRepo.dailyAiSpendUsd(opts.sessionId),
      pipelineSpentBeforePhaseUsd,
    });

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

    const workerRunBase = {
      phase: opts.phase,
      sessionId: opts.sessionId,
      cycleId: opts.cycleId ?? null,
      tradeId: opts.tradeId ?? null,
      spendTracker,
    };

    if (definition.run) {
      const runner: PipelineWorkerRunner = {
        execute: <T>(worker: WorkerDefinition, task: Record<string, unknown>) =>
          executeWorker<T>(executorDeps, {
            ...workerRunBase,
            worker,
            task,
          }),
        executeGroup: (tasks, concurrency) => runConcurrentGroup(tasks, concurrency, () => spendTracker.canContinue()),
        canContinueWorkers: () => spendTracker.canContinue(),
      };
      const ctx: PipelineRunContext = {
        input: opts.input as Record<string, unknown>,
        sessionId: opts.sessionId,
        cycleId: opts.cycleId ?? null,
        tradeId: opts.tradeId ?? null,
        toolContext,
        strategyContext,
        spendTracker,
      };
      const result = (await definition.run(ctx, runner)) as AgentResult<TOutput>;
      this.recordCycleSpend(cycleKey, spendTracker.phaseSpent);
      return result;
    }

    const task = opts.input as Record<string, unknown>;
    const terminalToolNames = opts.terminalToolNames ?? definition.terminalToolNames;
    const prepareStep = opts.prepareStep ?? definition.buildPrepareStep?.(toolContext);

    const schedule = buildWorkerSchedule(workers as never, definition.scheduling);
    const shouldContinue = () => spendTracker.canContinue();
    const executed = await executeByFrontier(
      schedule.ordered,
      schedule.maxConcurrency,
      async ({ worker }) =>
        executeWorker<unknown>(executorDeps, {
          ...workerRunBase,
          worker,
          task,
          terminalToolNames,
          prepareStep,
        }),
      shouldContinue,
    );

    if (!shouldContinue()) {
      const abortMessage = spendTracker.abortLogMessage();
      if (abortMessage) logger.warn({ sessionId: opts.sessionId, phase: opts.phase, cycleId: opts.cycleId ?? null }, abortMessage);
    }

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

    this.recordCycleSpend(cycleKey, spendTracker.phaseSpent);
    return { run: aggregate.run, message: aggregate.message, output };
  }

  private recordCycleSpend(cycleKey: string, phaseSpentUsd: number): void {
    if (phaseSpentUsd <= 0) return;
    this.cycleSpendUsd.set(cycleKey, (this.cycleSpendUsd.get(cycleKey) ?? 0) + phaseSpentUsd);
    if (this.cycleSpendUsd.size > 500) {
      const oldest = this.cycleSpendUsd.keys().next().value;
      if (oldest !== undefined) this.cycleSpendUsd.delete(oldest);
    }
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
    if (output && typeof output === "object") {
      for (const key of Object.keys(output as object)) {
        if (key in acc) logger.warn({ key }, "worker output key collision in phase aggregation");
      }
      Object.assign(acc, output);
    }
    return acc;
  }, {});
}
