import type {
  PipelineDefinition,
  PipelinePhase,
  WorkerDefinition,
} from "@electron/shared/ai/ai-phase";
import { DEFAULT_PIPELINE_CONFIG } from "@electron/shared/ai/ai-phase-config";
import type {
  EffectivePipelineConfig,
  EffectiveStageConfig,
  EffectiveWorkerConfig,
} from "@electron/shared/ai/effective-ai-phase-config";
import type { SessionStrategyContext } from "@electron/shared/domain";
import { AppError } from "@electron/shared/infra/errors";
import { requireExperience } from "../../experiences/index";
import { requireEngine } from "../signal/registry/signal-engine-registry";
import { SUPPORTED_TOOL_IDS } from "./worker-tools/worker-tool-factory";
import {
  assertValidPipelineDefinitionRegistry,
  listPipelineDefinitions,
} from "./core/pipeline-registry";
import type { AIPhaseConfigResolver } from "./ai-phase-config-resolver";
import { resolvePhaseWorkers } from "./definitions/phase-catalog";
import { getAIPhase } from "./phases/registry";
import { resolveEffectivePlanStages } from "./implementations/registry/analysis-resolver";

export { DEFAULT_PIPELINE_ID } from "./pipeline-constants";
import { DEFAULT_PIPELINE_ID } from "./pipeline-constants";

const SUPPORTED_TOOL_ID_SET = new Set<string>(SUPPORTED_TOOL_IDS);

export interface ResolveEffectivePipelineConfigOptions {
  sessionId: string;
  pipelineId?: string;
  experienceId?: string;
  phaseConfigResolver: AIPhaseConfigResolver;
  strategyContext?: SessionStrategyContext | null;
}

export function resolveEffectivePipelineConfig(
  opts: ResolveEffectivePipelineConfigOptions,
): EffectivePipelineConfig {
  const pipelineId = opts.pipelineId ?? DEFAULT_PIPELINE_ID;
  const stages = listPipelineDefinitions().map(({ phase, definition }) =>
    resolveEffectiveStage({
      phase,
      definition,
      pipelineId,
      sessionId: opts.sessionId,
      experienceId: opts.experienceId,
      phaseConfigResolver: opts.phaseConfigResolver,
      strategyContext: opts.strategyContext ?? null,
    }),
  );
  const workers = stages.flatMap((stage) => stage.workers);
  const engines = uniqueEngineBindings([
    ...stages.flatMap((stage) => stage.engines),
    ...workers.flatMap((worker) => worker.engines),
  ]);

  return {
    pipelineId: opts.pipelineId ?? DEFAULT_PIPELINE_ID,
    sessionId: opts.sessionId,
    stages,
    workers,
    engines,
    budgets: {
      totalSpendCapUsd: DEFAULT_PIPELINE_CONFIG.totalSpendCapUsd,
      phases: DEFAULT_PIPELINE_CONFIG.phases,
    },
    sourceMap: buildSourceMap(stages),
    planStages: resolveEffectivePlanStages(
      opts.pipelineId ?? DEFAULT_PIPELINE_ID,
    ),
  };
}

export function assertValidEffectivePipelineConfig(
  config: EffectivePipelineConfig,
): void {
  const errors: string[] = [];

  for (const stage of config.stages) {
    if (stage.workers.length === 0) {
      errors.push(`Stage '${stage.id}' has no workers.`);
    }

    for (const binding of stage.engines) {
      validateEngineBinding(errors, `Stage '${stage.id}'`, binding);
    }

    for (const worker of stage.workers) {
      for (const toolId of worker.tools) {
        if (!SUPPORTED_TOOL_ID_SET.has(toolId)) {
          errors.push(
            `Worker '${worker.workerId}' in phase '${stage.id}' references unknown tool '${toolId}'.`,
          );
        }
      }

      for (const binding of worker.engines) {
        validateEngineBinding(
          errors,
          `Worker '${worker.workerId}' in phase '${stage.id}'`,
          binding,
        );
      }

      if (worker.promptSource === "default" && !worker.prompt.trim()) {
        errors.push(
          `Worker '${worker.workerId}' in phase '${stage.id}' has an empty default prompt.`,
        );
      }
    }
  }

  if (errors.length > 0) {
    throw new AppError(
      `Effective pipeline config is invalid:\n${errors.join("\n")}`,
      "VALIDATION_FAILED",
      {
        pipelineId: config.pipelineId,
        sessionId: config.sessionId,
        errors,
      },
    );
  }
}

export function assertValidPipelineDefinitionCatalog(): void {
  assertValidPipelineDefinitionRegistry();
  const errors: string[] = [];
  for (const { phase, definition } of listPipelineDefinitions()) {
    for (const binding of definition.engines ?? []) {
      validateEngineBinding(errors, `Phase '${phase}'`, binding);
    }

    for (const pipelineId of [
      DEFAULT_PIPELINE_ID,
      "edgar-8k-cycle",
      "rules-mean-reversion-cycle",
      "rules-trend-following-cycle",
      "rules-breakout-cycle",
    ]) {
      const workers = workersForEffectiveStage(phase, pipelineId);
      if (workers.length === 0 && phase !== "decision") {
        continue;
      }
      for (const worker of workers) {
        for (const toolId of worker.tools) {
          if (!SUPPORTED_TOOL_ID_SET.has(toolId)) {
            errors.push(
              `Worker '${worker.id}' in phase '${phase}' pipeline '${pipelineId}' references unknown tool '${toolId}'.`,
            );
          }
        }
        for (const binding of worker.engines ?? []) {
          validateEngineBinding(
            errors,
            `Worker '${worker.id}' in phase '${phase}' pipeline '${pipelineId}'`,
            binding,
          );
        }
        if (!worker.prompt.trim()) {
          errors.push(
            `Worker '${worker.id}' in phase '${phase}' pipeline '${pipelineId}' has an empty prompt.`,
          );
        }
      }
    }
  }

  if (errors.length > 0) {
    throw new AppError(
      `Pipeline definition catalog is invalid:\n${errors.join("\n")}`,
      "VALIDATION_FAILED",
      { errors },
    );
  }
}

function resolveEffectiveStage(input: {
  phase: PipelinePhase;
  definition: PipelineDefinition;
  pipelineId: string;
  sessionId: string;
  experienceId?: string;
  phaseConfigResolver: AIPhaseConfigResolver;
  strategyContext: SessionStrategyContext | null;
}): EffectiveStageConfig {
  const promptVariantKey = resolvePromptVariantKey(input);
  const plan = getAIPhase(input.phase);
  const workers = workersForEffectiveStage(input.phase, input.pipelineId);
  const schedulingMode = plan
    ? plan.stages.length > 1
      ? "dependency_graph"
      : "flat_parallel"
    : input.definition.run
      ? "custom_run"
      : (input.definition.scheduling?.mode ?? "flat_parallel");
  const maxConcurrency = plan
    ? Math.max(...plan.stages.map((stage) => stage.concurrency), 1)
    : input.definition.run
      ? workers.length
      : (input.definition.scheduling?.maxConcurrency ??
        Math.max(1, workers.length));

  return {
    id: input.phase,
    kind: "phase",
    phase: input.phase,
    variantKey: variantKeyForPhase(input.phase, promptVariantKey),
    outputMode: input.definition.outputMode,
    outputSchemaName: input.definition.persistence.outputSchemaName,
    schedulingMode,
    maxConcurrency,
    traceMode: input.definition.persistence.traceMode,
    phaseSpendCapUsd: input.phaseConfigResolver.resolvePhaseSpendCapUsd(
      input.phase,
    ),
    inputBuilders: plan?.inputEngineIds,
    cachePolicy: plan?.cacheEngineId,
    engines: input.definition.engines ?? [],
    workers: workers.map((worker) =>
      resolveEffectiveWorker({
        phase: input.phase,
        worker,
        sessionId: input.sessionId,
        phaseConfigResolver: input.phaseConfigResolver,
        definition: input.definition,
      }),
    ),
  };
}

function resolveEffectiveWorker(input: {
  phase: PipelinePhase;
  worker: WorkerDefinition;
  sessionId: string;
  phaseConfigResolver: AIPhaseConfigResolver;
  definition: PipelineDefinition;
}): EffectiveWorkerConfig {
  const workerExecConfig = input.phaseConfigResolver.resolveWorkerExecConfig(
    input.sessionId,
    input.phase,
    input.worker.id,
  );
  const runtimeConfig = input.phaseConfigResolver.resolveWorkerRuntimeConfig(
    input.phase,
    input.worker,
    workerExecConfig.workerOverride,
  );

  return {
    phase: input.phase,
    workerId: input.worker.id,
    prompt: input.worker.prompt,
    promptSource: workerExecConfig.promptSource,
    providerKey: workerExecConfig.providerKey,
    modelId: workerExecConfig.modelId,
    temperature: workerExecConfig.temperature,
    maxTokens: workerExecConfig.maxTokens,
    tools: runtimeConfig.tools,
    toolConfig: input.worker.toolConfig,
    engines: runtimeConfig.engines,
    outputMode: input.worker.outputMode,
    outputSchemaName: input.worker.outputSchema ? input.worker.id : null,
    dependsOn: input.worker.dependsOn ?? [],
    requiredForPhase: input.worker.requiredForPhase ?? true,
    caps: runtimeConfig.caps,
    retry: runtimeConfig.retry,
    terminalToolNames:
      input.definition.terminalToolNames ?? runtimeConfig.terminalToolNames,
  };
}

function workersForEffectiveStage(
  phase: PipelinePhase,
  pipelineId: string,
): readonly WorkerDefinition[] {
  return resolvePhaseWorkers(phase, pipelineId);
}

function resolvePromptVariantKey(input: {
  experienceId?: string;
  strategyContext: SessionStrategyContext | null;
}): SessionStrategyContext["researchPosture"]["processingMode"] {
  if (input.experienceId) {
    try {
      return requireExperience(input.experienceId).promptVariantKey;
    } catch {
      // fall through to posture default
    }
  }
  return input.strategyContext?.researchPosture.processingMode ?? "catalyst";
}

function variantKeyForPhase(
  phase: PipelinePhase,
  promptVariantKey: SessionStrategyContext["researchPosture"]["processingMode"],
): string {
  if (phase === "selector" || phase === "technical" || phase === "fundamental")
    return promptVariantKey;
  return "default";
}

function uniqueEngineBindings(
  bindings: readonly import("@electron/shared/ai/ai-phase").EngineBinding[],
): import("@electron/shared/ai/ai-phase").EngineBinding[] {
  const seen = new Set<string>();
  const out: import("@electron/shared/ai/ai-phase").EngineBinding[] = [];
  for (const binding of bindings) {
    const key = `${binding.engine}:${binding.kind}:${binding.mode}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(binding);
  }
  return out;
}

function validateEngineBinding(
  errors: string[],
  owner: string,
  binding: import("@electron/shared/ai/ai-phase").EngineBinding,
): void {
  try {
    const engine = requireEngine(binding.engine);
    if (engine.kind !== binding.kind) {
      errors.push(
        `${owner} binds engine '${binding.engine}' as kind '${binding.kind}', but registry kind is '${engine.kind}'.`,
      );
    }
  } catch (error) {
    errors.push(
      `${owner} references missing engine '${binding.engine}': ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function buildSourceMap(
  stages: EffectiveStageConfig[],
): EffectivePipelineConfig["sourceMap"] {
  return [
    {
      path: "DEFAULT_PIPELINE_CONFIG.totalSpendCapUsd",
      source: "default",
      value: DEFAULT_PIPELINE_CONFIG.totalSpendCapUsd,
    },
    ...stages.flatMap((stage) => [
      {
        path: `stages.${stage.id}.variantKey`,
        source: "derived" as const,
        value: stage.variantKey,
      },
      {
        path: `stages.${stage.id}.phaseSpendCapUsd`,
        source: "default" as const,
        value: stage.phaseSpendCapUsd,
      },
      ...stage.workers.flatMap((worker) => [
        {
          path: `stages.${stage.id}.workers.${worker.workerId}.providerKey`,
          source: "db" as const,
          value: worker.providerKey,
        },
        {
          path: `stages.${stage.id}.workers.${worker.workerId}.modelId`,
          source: "db" as const,
          value: worker.modelId,
        },
        {
          path: `stages.${stage.id}.workers.${worker.workerId}.prompt`,
          source: "default" as const,
          value: worker.prompt,
        },
        {
          path: `stages.${stage.id}.workers.${worker.workerId}.tools`,
          source: "default" as const,
          value: worker.tools,
        },
      ]),
    ]),
  ];
}
