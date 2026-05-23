import type {
  PipelinePhase,
  ReasoningLevel,
  WorkerDefinition,
  SessionAiPhaseWorker,
} from "@electron/shared/ai/pipeline-phase";
import {
  RUNTIME_DEFAULTS as DEFAULTS,
  PHASE_DEFAULTS,
} from "@electron/shared/ai/pipeline-phase";
import {
  PAPER_MOCK_BUDGETS,
  resolvePhaseSpendCapUsd as resolvePhaseSpendCapUsdForProfile,
} from "@electron/shared/ai/pipeline-config";
import type { ResolvedWorkerRuntimeConfig } from "./core/types";
import type { SessionAiPhasesRepo } from "../../db/repositories/sessions/session-ai-phases-repo";

export interface ResolvedPhaseExecConfig {
  providerKey: string;
  modelId: string;
  temperature: number;
  maxTokens: number;
  reasoningLevel: ReasoningLevel;
  promptSource: "default" | "session_override";
  promptMarkdown: string;
}

export interface ResolvedWorkerExecConfig extends ResolvedPhaseExecConfig {
  workerOverride: SessionAiPhaseWorker | null;
}

export class PhaseConfigResolver {
  constructor(private readonly aiPhasesRepo: SessionAiPhasesRepo) {}

  resolvePhaseConfig(
    sessionId: string,
    phase: PipelinePhase,
  ): ResolvedPhaseExecConfig {
    const row = this.aiPhasesRepo.getByPhase(sessionId, phase);
    return {
      providerKey: row?.providerKey ?? "",
      modelId: row?.modelId ?? "",
      temperature: row?.temperature ?? 0.7,
      maxTokens: row?.maxTokens ?? 8_192,
      reasoningLevel: row?.reasoningLevel ?? "off",
      promptSource: row?.promptSource ?? "default",
      promptMarkdown: row?.promptMarkdown ?? "",
    };
  }

  resolveWorkerExecConfig(
    sessionId: string,
    phase: PipelinePhase,
    workerId: string,
  ): ResolvedWorkerExecConfig {
    const phaseConfig = this.resolvePhaseConfig(sessionId, phase);
    const workerOverride = this.aiPhasesRepo.getWorker(
      sessionId,
      phase,
      workerId,
    );
    const promptMarkdown = workerOverride?.promptMarkdown?.trim()
      ? workerOverride.promptMarkdown
      : phaseConfig.promptMarkdown;

    return {
      ...phaseConfig,
      providerKey:
        workerOverride?.providerKey?.trim() || phaseConfig.providerKey,
      modelId: workerOverride?.modelId?.trim() || phaseConfig.modelId,
      promptMarkdown,
      workerOverride,
    };
  }

  resolvePhaseSpendCapUsd(
    phase: PipelinePhase,
    sandbox = false,
  ): number {
    return resolvePhaseSpendCapUsdForProfile(phase, sandbox);
  }

  resolveWorkerRuntimeConfig(
    phase: PipelinePhase,
    worker: WorkerDefinition,
    workerOverride?: SessionAiPhaseWorker | null,
    sandbox = false,
  ): ResolvedWorkerRuntimeConfig {
    const phaseDefaults = PHASE_DEFAULTS[phase];
    const sandboxWorkerCaps =
      sandbox && phase === "selector"
        ? PAPER_MOCK_BUDGETS.workerCaps.selector
        : sandbox
          ? PAPER_MOCK_BUDGETS.workerCaps.trade
          : null;
    const caps = {
      ...DEFAULTS.workerCaps,
      ...phaseDefaults.workerCaps,
      ...sandboxWorkerCaps,
      ...worker.caps,
      ...(workerOverride?.maxSteps != null
        ? { maxSteps: workerOverride.maxSteps }
        : {}),
      ...(workerOverride?.spendLimitUsd != null
        ? { spendLimitUsd: workerOverride.spendLimitUsd }
        : {}),
    };
    const retry = { ...DEFAULTS.retry, ...phaseDefaults.retry };
    const tools =
      worker.tools.length > 0 ? worker.tools : (phaseDefaults.tools ?? []);
    const engines =
      (worker.engines?.length ? worker.engines : phaseDefaults.engines) ?? [];
    const output = worker.outputSchema
      ? {
          schema: worker.outputSchema,
          strict: true as const,
          onValidationFailure: "retry_once" as const,
        }
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
