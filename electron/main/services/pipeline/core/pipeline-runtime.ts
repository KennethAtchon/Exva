import type { PrepareStepFunction, ToolSet } from "ai";
import { AppError } from "@electron/shared/infra/errors";
import type {
  PipelinePhase,
  WorkerDefinition,
} from "@electron/shared/ai/ai-phase";
import {
  runAIWorker,
  type AIWorkerRunnerDeps,
} from "../execution/worker-executor";
import { runWorkersConcurrently } from "./concurrent-group-runner";
import type { AIWorkerRunner } from "./types";
import type { AIPhaseConfigResolver } from "../ai-phase-config-resolver";
import type { ProviderRegistry } from "../../llm/provider-registry";
import type { WorkerToolContext } from "../worker-tools/worker-tool-factory";
import type { SessionStrategyContextService } from "../../session/session-strategy-context-service";
import type { SessionRepo } from "../../../db/repositories/sessions/session-repo";
import type { WorkspacePreferencesRepo } from "../../../db/repositories/workspace/workspace-prefs-repo";
import type { ApiCallLogRepo } from "../../../db/repositories/system/api-call-log-repo";
import type { AgentRunsRepo } from "../../../db/repositories/agents/agent-runs-repo";
import type { SearchRegistry } from "../../search";
import type { BrokerRoutingService } from "../../broker/broker-routing-service";
import type { BrokerRegistry } from "../../broker/broker-registry";
import { resolveSessionInstrumentClasses } from "../../session/effective-instrument-classes";
import { resolveWorkerToolContext } from "../worker-tools/worker-tool-resolver";
import { runWithProviderCallScopeAsync } from "../../infra/provider-call-log";
import {
  isSandboxBudgetProfile,
  PAPER_MOCK_BUDGETS,
  resolveTotalSpendCapUsd,
} from "@electron/shared/ai/ai-phase-config";
import { AISpendTracker } from "../execution/ai-spend-tracker";
import type { EffectivePipelineConfig } from "@electron/shared/ai/effective-ai-phase-config";
import {
  assertValidEffectivePipelineConfig,
  DEFAULT_PIPELINE_ID,
  resolveEffectivePipelineConfig,
} from "../effective-ai-phase-config";
import { AIPhaseRunner } from "../phases/interpreter";
import { requireAIPhase } from "../phases/registry";
import type { AIPhaseServices } from "../phases/services";
import { InstrumentAnalysisRunner } from "../analysis/interpreter";
import { resolvePipelineIdForExperience } from "../../../experiences";
import { requireInstrumentAnalysis } from "../analysis/registry";
import { requireAnalysis } from "../implementations/registry/analysis-resolver";
import type { InstrumentAnalysisServices } from "../analysis/services";
import type {
  AnalysisStepRunner,
  TradeCycleInstrument,
  InstrumentAnalysisState,
  InstrumentAnalysisResult,
} from "../analysis/types";
import type { SessionConfig } from "@/lib/types";
import type { InstrumentClass } from "@/lib/types";
import { createLogger } from "../../infra/log";

const logger = createLogger("pipeline-runtime");

export interface PipelineRuntimeDeps {
  providerRegistry: ProviderRegistry;
  phaseConfigResolver: AIPhaseConfigResolver;
  strategyContextService: SessionStrategyContextService | null;
  sessionRepo: SessionRepo;
  workspacePrefsRepo: WorkspacePreferencesRepo;
  apiCallLogRepo: ApiCallLogRepo;
  agentRunsRepo: AgentRunsRepo;
  searchRegistry: SearchRegistry;
  brokerRouting?: BrokerRoutingService;
  brokerRegistry?: BrokerRegistry;
  planServices?: AIPhaseServices | null;
  cyclePlanServices?: InstrumentAnalysisServices | null;
}

export interface RunPhaseOptions<TInput = Record<string, unknown>> {
  phase: PipelinePhase;
  pipelineId?: string;
  sessionId: string;
  input: TInput;
  cycleId?: string | null;
  tradeId?: string | null;
  toolContext?: WorkerToolContext;
  prepareStep?: PrepareStepFunction<ToolSet>;
  terminalToolNames?: readonly string[];
}

export class PipelineRuntime {
  private readonly cycleSpendUsd = new Map<string, number>();
  private readonly planInterpreter = new AIPhaseRunner();
  private readonly cycleAnalysisDispatcher = new InstrumentAnalysisRunner();

  constructor(private readonly deps: PipelineRuntimeDeps) {}

  setStrategyContextService(
    strategyContextService: SessionStrategyContextService,
  ): void {
    this.deps.strategyContextService = strategyContextService;
    if (this.deps.planServices) {
      this.deps.planServices.strategyContextService = strategyContextService;
    }
    if (this.deps.cyclePlanServices) {
      this.deps.cyclePlanServices.strategyContextService =
        strategyContextService;
    }
  }

  setPlanServices(planServices: AIPhaseServices): void {
    this.deps.planServices = planServices;
  }

  setInstrumentAnalysisServices(
    cyclePlanServices: InstrumentAnalysisServices,
  ): void {
    this.deps.cyclePlanServices = cyclePlanServices;
  }

  mergeCyclePlanServices(patch: Partial<InstrumentAnalysisServices>): void {
    if (!this.deps.cyclePlanServices) return;
    this.deps.cyclePlanServices = {
      ...this.deps.cyclePlanServices,
      ...patch,
    };
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
      seedState?: Partial<InstrumentAnalysisState>;
      runStep?: AnalysisStepRunner;
      lastStageId?: string;
    },
  ): Promise<InstrumentAnalysisResult> {
    const plan = requireInstrumentAnalysis(cyclePlanId);
    if (!this.deps.cyclePlanServices) {
      throw new AppError(
        `Cycle plan services are not configured for '${cyclePlanId}'.`,
        "UNKNOWN",
      );
    }

    const strategyContext = this.requireStrategyContextService().get(
      opts.sessionId,
    );
    const toolContext = await resolveWorkerToolContext(this.deps, {
      sessionId: opts.sessionId,
      cycleId: opts.cycleId,
      tradeId: opts.tradeId ?? null,
      strategyContext,
    });
    const session = this.deps.sessionRepo.requireById(opts.sessionId);
    const cyclePlanServices = this.deps.cyclePlanServices;

    return runWithProviderCallScopeAsync(
      {
        sessionId: opts.sessionId,
        cycleId: opts.cycleId,
        tradeId: opts.tradeId ?? null,
      },
      () =>
        this.cycleAnalysisDispatcher.run({
          plan: plan as import("../analysis/types").InstrumentAnalysis<InstrumentAnalysisState>,
          sessionId: opts.sessionId,
          cycleId: opts.cycleId,
          tradeId: opts.tradeId ?? null,
          instrument: opts.instrument,
          sessionConfig: opts.sessionConfig,
          instrumentClasses: opts.instrumentClasses,
          session,
          strategyContext,
          toolContext,
          services: cyclePlanServices,
          seedState: opts.seedState,
          runStep: opts.runStep,
          lastStageId: opts.lastStageId,
          runAIPhase: (phase, input) =>
            this.runAIPhase({
              phase,
              pipelineId: cyclePlanId,
              sessionId: opts.sessionId,
              input,
              cycleId: opts.cycleId,
              tradeId: opts.tradeId ?? null,
              toolContext,
            }),
        }),
    );
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
      seedState?: Partial<InstrumentAnalysisState>;
      runStep?: AnalysisStepRunner;
      lastStageId?: string;
    },
  ): Promise<
    InstrumentAnalysisResult | import("../phases/types").AIPhaseResult<unknown>
  > {
    const plan = requireAnalysis(planId);
    if (plan.kind === "phase") {
      // A phase's pipeline is knowable only from the session's experience —
      // never from the signal source type (timer is shared by three pipelines,
      // and a trigger-less cycle has no source at all).
      const session = this.deps.sessionRepo.requireById(opts.sessionId);
      const pipelineId = resolvePipelineIdForExperience(session.experienceId);
      return this.runAIPhase({
        phase: plan.id,
        pipelineId,
        sessionId: opts.sessionId,
        cycleId: opts.cycleId,
        tradeId: opts.tradeId ?? null,
        input: opts.input ?? {},
      });
    }

    if (!opts.instrument || !opts.sessionConfig || !opts.instrumentClasses) {
      throw new AppError(
        `Cycle plan '${planId}' requires instrument, sessionConfig, and instrumentClasses.`,
        "VALIDATION_FAILED",
      );
    }

    return this.runCycle(planId, {
      sessionId: opts.sessionId,
      cycleId: opts.cycleId,
      tradeId: opts.tradeId,
      instrument: opts.instrument,
      sessionConfig: opts.sessionConfig,
      instrumentClasses: opts.instrumentClasses,
      seedState: opts.seedState,
      runStep: opts.runStep,
      lastStageId: opts.lastStageId,
    });
  }

  resolveEffectiveConfig(
    sessionId: string,
    pipelineId = DEFAULT_PIPELINE_ID,
  ): EffectivePipelineConfig {
    const strategyContext = this.requireStrategyContextService().get(sessionId);
    const session = this.deps.sessionRepo.get(sessionId);
    return resolveEffectivePipelineConfig({
      sessionId,
      pipelineId,
      experienceId: session?.experienceId,
      phaseConfigResolver: this.deps.phaseConfigResolver,
      strategyContext,
    });
  }

  assertValidEffectiveConfig(
    sessionId: string,
    pipelineId = DEFAULT_PIPELINE_ID,
  ): EffectivePipelineConfig {
    const config = this.resolveEffectiveConfig(sessionId, pipelineId);
    assertValidEffectivePipelineConfig(config);
    return config;
  }

  async resolveWorkerToolContext(
    sessionId: string,
    cycleId: string | null,
    strategyContext = this.requireStrategyContextService().get(sessionId),
    tradeId: string | null = null,
  ): Promise<WorkerToolContext> {
    return resolveWorkerToolContext(this.deps, {
      sessionId,
      cycleId,
      tradeId,
      strategyContext,
    });
  }

  async runAIPhase<TOutput>(
    opts: Omit<RunPhaseOptions, "input"> & { input?: Record<string, unknown> },
  ): Promise<import("../phases/types").AIPhaseResult<TOutput>> {
    const plan = requireAIPhase(opts.phase);
    if (!this.deps.planServices) {
      throw new AppError(
        `Phase plan services are not configured for '${opts.phase}'.`,
        "UNKNOWN",
      );
    }

    const strategyContext = this.requireStrategyContextService().get(
      opts.sessionId,
    );
    const cycleKey = opts.cycleId ?? opts.sessionId;
    const session = this.deps.sessionRepo.requireById(opts.sessionId);
    const instrumentClasses = resolveSessionInstrumentClasses(
      session,
      this.deps.planServices,
    );
    const baseToolContext =
      opts.toolContext ??
      (await resolveWorkerToolContext(this.deps, {
        sessionId: opts.sessionId,
        cycleId: opts.cycleId,
        tradeId: opts.tradeId,
        strategyContext,
      }));
    const toolContext: WorkerToolContext = {
      ...baseToolContext,
      instrumentClasses,
    };
    const sandboxBudget = isSandboxBudgetProfile({
      isMockSession: toolContext.isMockSession,
    });
    const sessionSpendCapUsd = sandboxBudget
      ? Math.max(
          strategyContext.riskConfig.maxAiSpendUsd,
          PAPER_MOCK_BUDGETS.sessionMaxAiSpendUsd,
        )
      : strategyContext.riskConfig.maxAiSpendUsd;
    const spendTracker = new AISpendTracker({
      phaseSpendCapUsd: this.deps.phaseConfigResolver.resolvePhaseSpendCapUsd(
        opts.phase,
        sandboxBudget,
      ),
      pipelineSpendCapUsd: resolveTotalSpendCapUsd(sandboxBudget),
      sessionSpendCapUsd,
      sessionSpentBeforeRunUsd: this.deps.agentRunsRepo.dailyAiSpendUsd(
        opts.sessionId,
      ),
      pipelineSpentBeforePhaseUsd: opts.cycleId
        ? (this.cycleSpendUsd.get(cycleKey) ?? 0)
        : 0,
      warnOnly: sandboxBudget,
    });

    logger.info(
      {
        sessionId: opts.sessionId,
        phase: opts.phase,
        cycleId: opts.cycleId ?? null,
        tradeId: opts.tradeId ?? null,
        sandboxBudget,
        phaseSpendCapUsd: this.deps.phaseConfigResolver.resolvePhaseSpendCapUsd(
          opts.phase,
          sandboxBudget,
        ),
        pipelineSpendCapUsd: resolveTotalSpendCapUsd(sandboxBudget),
        sessionSpendCapUsd,
        sessionSpentBeforeRunUsd: this.deps.agentRunsRepo.dailyAiSpendUsd(
          opts.sessionId,
        ),
        pipelineSpentBeforePhaseUsd: opts.cycleId
          ? (this.cycleSpendUsd.get(cycleKey) ?? 0)
          : 0,
        inputKeys: Object.keys(opts.input ?? {}).sort(),
      },
      "phase run start",
    );

    const executorDeps: AIWorkerRunnerDeps = {
      providerRegistry: this.deps.providerRegistry,
      phaseConfigResolver: this.deps.phaseConfigResolver,
      toolContext,
      strategyContext,
      sandboxBudget,
    };

    const workerRunBase = {
      phase: opts.phase,
      sessionId: opts.sessionId,
      cycleId: opts.cycleId ?? null,
      tradeId: opts.tradeId ?? null,
      spendTracker,
    };

    const runner: AIWorkerRunner = {
      execute: <T>(worker: WorkerDefinition, task: Record<string, unknown>) =>
        runAIWorker<T>(executorDeps, { ...workerRunBase, worker, task }),
      executeGroup: (tasks, concurrency) =>
        runWorkersConcurrently(tasks, concurrency, () =>
          spendTracker.canContinue(),
        ),
      canContinueWorkers: () => spendTracker.canContinue(),
    };

    const planServices = this.deps.planServices;

    const result = await runWithProviderCallScopeAsync(
      {
        sessionId: opts.sessionId,
        cycleId: opts.cycleId ?? null,
        tradeId: opts.tradeId ?? null,
      },
      () =>
        this.planInterpreter.run<TOutput>({
          plan,
          pipelineId: opts.pipelineId ?? DEFAULT_PIPELINE_ID,
          sessionId: opts.sessionId,
          cycleId: opts.cycleId ?? null,
          tradeId: opts.tradeId ?? null,
          input: opts.input ?? {},
          session,
          strategyContext,
          toolContext,
          services: planServices,
          runner,
        }),
    );
    this.recordCycleSpend(cycleKey, spendTracker.phaseSpent);
    logger.info(
      {
        sessionId: opts.sessionId,
        phase: opts.phase,
        cycleId: opts.cycleId ?? null,
        tradeId: opts.tradeId ?? null,
        source: result.source,
        phaseSpentUsd: spendTracker.phaseSpent,
        pipelineSpentUsd: spendTracker.pipelineSpent,
        aggregateCostUsd: result.run?.cost_usd ?? null,
      },
      "phase run complete",
    );
    return result;
  }

  private recordCycleSpend(cycleKey: string, phaseSpentUsd: number): void {
    if (phaseSpentUsd <= 0) return;
    this.cycleSpendUsd.set(
      cycleKey,
      (this.cycleSpendUsd.get(cycleKey) ?? 0) + phaseSpentUsd,
    );
    if (this.cycleSpendUsd.size > 500) {
      const oldest = this.cycleSpendUsd.keys().next().value;
      if (oldest !== undefined) this.cycleSpendUsd.delete(oldest);
    }
  }

  private requireStrategyContextService(): SessionStrategyContextService {
    if (!this.deps.strategyContextService) {
      throw new AppError(
        "Strategy context service is not configured.",
        "UNKNOWN",
      );
    }
    return this.deps.strategyContextService;
  }
}
