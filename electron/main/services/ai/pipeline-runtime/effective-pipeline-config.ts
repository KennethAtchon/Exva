import type {
  PipelineDefinition,
  PipelinePhase,
  WorkerDefinition,
} from "@electron/shared/ai/pipeline-phase";
import { DEFAULT_PIPELINE_CONFIG } from "@electron/shared/ai/pipeline-config";
import type {
  EffectivePipelineConfig,
  EffectiveStageConfig,
  EffectiveWorkerConfig,
} from "@electron/shared/ai/effective-pipeline-config";
import type { SessionStrategyContext } from "@electron/shared/domain";
import { AppError } from "@electron/shared/infra/errors";
import type { PromptAssetLoader } from "../prompt-asset-loader";
import { requireEngine } from "../engines/registry/engine-registry";
import { SUPPORTED_TOOL_IDS } from "./context/tool-factory-registry";
import { listPipelineDefinitions } from "./core/pipeline-registry";
import type { PhaseConfigResolver } from "./phase-config-resolver";
import {
  fundamentalWorkersForMode,
  selectorDiscoveryWorkersForMode,
  technicalWorkersForMode,
} from "./pipeline-discovery-config";
import { getPhasePlan } from "./plan/phase/registry";
import { resolveEffectivePlanStages } from "./plan/unified/registry";

export const DEFAULT_PIPELINE_ID = "default-trade-cycle";

const SUPPORTED_TOOL_ID_SET = new Set<string>(SUPPORTED_TOOL_IDS);

export interface ResolveEffectivePipelineConfigOptions {
  sessionId: string;
  pipelineId?: string;
  phaseConfigResolver: PhaseConfigResolver;
  strategyContext?: SessionStrategyContext | null;
}

export interface ValidateEffectivePipelineConfigOptions {
  promptLoader?: Pick<PromptAssetLoader, "load">;
}

export interface ValidatePipelineDefinitionCatalogOptions {
  promptLoader?: Pick<PromptAssetLoader, "load">;
}

export function resolveEffectivePipelineConfig(
  opts: ResolveEffectivePipelineConfigOptions,
): EffectivePipelineConfig {
  const stages = listPipelineDefinitions().map(({ phase, definition }) =>
    resolveEffectiveStage({
      phase,
      definition,
      sessionId: opts.sessionId,
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
  opts: ValidateEffectivePipelineConfigOptions = {},
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

      if (opts.promptLoader && worker.promptSource === "default") {
        try {
          opts.promptLoader.load(worker.promptAssetPath);
        } catch (error) {
          errors.push(
            `Worker '${worker.workerId}' in phase '${stage.id}' references missing prompt '${worker.promptAssetPath}': ${error instanceof Error ? error.message : String(error)}`,
          );
        }
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

export function assertValidPipelineDefinitionCatalog(
  opts: ValidatePipelineDefinitionCatalogOptions = {},
): void {
  const errors: string[] = [];
  const discoveryModes: Array<
    SessionStrategyContext["researchPosture"]["discoveryMode"]
  > = ["trend_scan", "event_contract_scan"];

  for (const { phase, definition } of listPipelineDefinitions()) {
    for (const binding of definition.engines ?? []) {
      validateEngineBinding(errors, `Phase '${phase}'`, binding);
    }

    const variantKeys =
      phase === "selector" || phase === "technical" || phase === "fundamental"
        ? discoveryModes
        : (["default"] as const);

    for (const variantKey of variantKeys) {
      const workers = workersForEffectiveStage(
        phase,
        definition,
        variantKey === "default" ? "trend_scan" : variantKey,
      );
      if (workers.length === 0) {
        errors.push(`Phase '${phase}' variant '${variantKey}' has no workers.`);
      }
      for (const worker of workers) {
        for (const toolId of worker.tools) {
          if (!SUPPORTED_TOOL_ID_SET.has(toolId)) {
            errors.push(
              `Worker '${worker.id}' in phase '${phase}' variant '${variantKey}' references unknown tool '${toolId}'.`,
            );
          }
        }
        for (const binding of worker.engines ?? []) {
          validateEngineBinding(
            errors,
            `Worker '${worker.id}' in phase '${phase}' variant '${variantKey}'`,
            binding,
          );
        }
        if (opts.promptLoader) {
          try {
            opts.promptLoader.load(worker.promptAssetPath);
          } catch (error) {
            errors.push(
              `Worker '${worker.id}' in phase '${phase}' variant '${variantKey}' references missing prompt '${worker.promptAssetPath}': ${error instanceof Error ? error.message : String(error)}`,
            );
          }
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
  sessionId: string;
  phaseConfigResolver: PhaseConfigResolver;
  strategyContext: SessionStrategyContext | null;
}): EffectiveStageConfig {
  const discoveryMode =
    input.strategyContext?.researchPosture.discoveryMode ?? "trend_scan";
  const plan = getPhasePlan(input.phase);
  const workers = workersForEffectiveStage(
    input.phase,
    input.definition,
    discoveryMode,
  );
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
    variantKey: variantKeyForPhase(input.phase, discoveryMode),
    outputMode: input.definition.outputMode,
    outputSchemaName: input.definition.persistence.outputSchemaName,
    schedulingMode,
    maxConcurrency,
    traceMode: input.definition.persistence.traceMode,
    phaseSpendCapUsd: input.phaseConfigResolver.resolvePhaseSpendCapUsd(
      input.phase,
    ),
    inputBuilders: plan?.inspect.inputBuilderIds,
    cachePolicy: plan?.inspect.cachePolicyId,
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
  phaseConfigResolver: PhaseConfigResolver;
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
    promptAssetPath: input.worker.promptAssetPath,
    promptSource: workerExecConfig.promptSource,
    providerKey: workerExecConfig.providerKey,
    modelId: workerExecConfig.modelId,
    temperature: workerExecConfig.temperature,
    maxTokens: workerExecConfig.maxTokens,
    tools: runtimeConfig.tools,
    toolConfig: input.worker.toolConfig,
    engines: runtimeConfig.engines,
    outputMode: input.worker.outputMode,
    outputSchemaName:
      input.worker.outputMode === "object" ? input.worker.id : null,
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
  definition: PipelineDefinition,
  discoveryMode: SessionStrategyContext["researchPosture"]["discoveryMode"],
): readonly WorkerDefinition[] {
  if (phase === "selector")
    return selectorDiscoveryWorkersForMode(discoveryMode);
  if (phase === "technical") return technicalWorkersForMode(discoveryMode);
  if (phase === "fundamental") return fundamentalWorkersForMode(discoveryMode);
  return definition.workers;
}

function variantKeyForPhase(
  phase: PipelinePhase,
  discoveryMode: SessionStrategyContext["researchPosture"]["discoveryMode"],
): string {
  if (phase === "selector" || phase === "technical" || phase === "fundamental")
    return discoveryMode;
  return "default";
}

function uniqueEngineBindings(
  bindings: readonly import("@electron/shared/ai/pipeline-phase").EngineBinding[],
): import("@electron/shared/ai/pipeline-phase").EngineBinding[] {
  const seen = new Set<string>();
  const out: import("@electron/shared/ai/pipeline-phase").EngineBinding[] = [];
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
  binding: import("@electron/shared/ai/pipeline-phase").EngineBinding,
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
          path: `stages.${stage.id}.workers.${worker.workerId}.promptAssetPath`,
          source: "default" as const,
          value: worker.promptAssetPath,
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
