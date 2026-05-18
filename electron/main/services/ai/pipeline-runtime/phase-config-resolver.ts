import type { PipelinePhase, WorkerDefinition, SessionAiPhase, SessionAiPhaseWorker, RuntimeDefaultsConfig, RUNTIME_DEFAULTS } from "@electron/shared/ai/pipeline-phase";
import { RUNTIME_DEFAULTS as DEFAULTS, PHASE_DEFAULTS } from "@electron/shared/ai/pipeline-phase";
import type { ResolvedWorkerRuntimeConfig } from "./core/types";
import type { SessionAiPhasesRepo } from "../../../db/repositories/sessions/session-ai-phases-repo";

export interface ResolvedPhaseExecConfig {
  providerKey: string;
  modelId: string;
  temperature: number;
  maxTokens: number;
  promptSource: "default" | "session_override";
  promptMarkdown: string;
}

export class PhaseConfigResolver {
  constructor(private readonly aiPhasesRepo: SessionAiPhasesRepo) {}

  resolvePhaseConfig(sessionId: string, phase: PipelinePhase): ResolvedPhaseExecConfig {
    const row = this.aiPhasesRepo.getByPhase(sessionId, phase);
    return {
      providerKey: row?.providerKey ?? "",
      modelId: row?.modelId ?? "",
      temperature: row?.temperature ?? 0.7,
      maxTokens: row?.maxTokens ?? 8_192,
      promptSource: row?.promptSource ?? "default",
      promptMarkdown: row?.promptMarkdown ?? "",
    };
  }

  resolveWorkerRuntimeConfig(
    phase: PipelinePhase,
    worker: WorkerDefinition,
    workerOverride?: SessionAiPhaseWorker | null,
  ): ResolvedWorkerRuntimeConfig {
    const phaseDefaults = PHASE_DEFAULTS[phase];
    const caps = {
      ...DEFAULTS.workerCaps,
      ...phaseDefaults.workerCaps,
      ...worker.caps,
      ...(workerOverride?.maxSteps != null ? { maxSteps: workerOverride.maxSteps } : {}),
      ...(workerOverride?.spendLimitUsd != null ? { spendLimitUsd: workerOverride.spendLimitUsd } : {}),
    };
    const retry = { ...DEFAULTS.retry, ...phaseDefaults.retry };
    const tools = worker.tools.length > 0 ? worker.tools : (phaseDefaults.tools ?? []);
    const engines = (worker.engines?.length ? worker.engines : phaseDefaults.engines) ?? [];
    const output = worker.outputSchema
      ? { schema: worker.outputSchema, strict: true as const, onValidationFailure: "retry_once" as const }
      : null;

    return {
      retry,
      caps,
      prompt: DEFAULTS.prompt,
      tools,
      engines,
      output,
      terminalToolNames: [],
    };
  }
}
