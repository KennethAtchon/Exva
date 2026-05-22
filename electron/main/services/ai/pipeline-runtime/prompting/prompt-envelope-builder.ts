import type { PipelinePhase } from "@electron/shared/ai/pipeline-phase";
import type { WorkerStrategyContextRequest } from "@electron/shared/ai/pipeline-phase";
import { RUNTIME_DEFAULTS } from "@electron/shared/ai/pipeline-phase";
import type { SessionStrategyContext } from "@electron/shared/domain";
import type { MockScenarioKind } from "@electron/shared/domain/mock-scenario";
import { MOCK_SCENARIO_LABELS } from "@electron/shared/domain/mock-scenario";
import { buildWorkerStrategyPromptContext } from "../../strategy-prompt-context";
import type { RuntimeAgentMessage } from "../../ai-runtime/ai-runtime-types";
import { createLogger } from "../../../infra/log";
import { buildPresetBehaviorGuidance } from "./preset-behavior-guidance";

const logger = createLogger("prompt-envelope");

export interface PromptEnvelope {
  systemPrompt: string;
  userPayload: Record<string, unknown>;
}

export interface PromptEnvelopeInput {
  phase: PipelinePhase;
  workerId: string;
  basePromptMarkdown: string;
  task: Record<string, unknown>;
  strategyContext: SessionStrategyContext;
  strategyContextRequest: WorkerStrategyContextRequest;
  engineResults?: Record<string, unknown>;
  sandboxMode?: boolean;
  mockScenarioKind?: MockScenarioKind;
  riskPolicy?: {
    maxPositionUsd: number;
    maxDataSpendUsd: number;
    humanApprovalRequired: boolean;
  } | null;
}

export interface PromptEnvelopeSizeReport {
  systemChars: number;
  userChars: number;
  maxSystemChars: number;
  maxUserChars: number;
  exceedsSystem: boolean;
  exceedsUser: boolean;
}

export function buildPromptEnvelope(
  input: PromptEnvelopeInput,
): PromptEnvelope {
  return {
    systemPrompt: input.basePromptMarkdown.trim(),
    userPayload: {
      phase: input.phase,
      workerId: input.workerId,
      task: input.task,
      strategyContextRequest: input.strategyContextRequest,
      engineResults: input.engineResults ?? {},
      sandboxMode: input.sandboxMode ?? false,
      mockScenarioKind: input.mockScenarioKind ?? null,
    },
  };
}

function renderSandboxSystemBlock(
  scenarioKind: MockScenarioKind | null | undefined,
): string {
  const scenario = scenarioKind ?? "clean_breakout";
  const label = MOCK_SCENARIO_LABELS[scenario];
  return [
    "## Sandbox Mode",
    "You are in Exva paper/mock mode. All tool data is synthetic but internally consistent.",
    "Evaluate it as real market evidence. Make a genuine trade/no-trade decision from the data.",
    "Do not skip solely because data is simulated. Do not mention sandbox status in analysis text.",
    `Scenario: ${scenario} (${label.label}; ${label.outcome}).`,
  ].join("\n");
}

function augmentMockTask(
  task: Record<string, unknown>,
  phase: PipelinePhase,
  sandboxMode: boolean,
): Record<string, unknown> {
  if (!sandboxMode || phase !== "selector") return task;
  const selectionInstructions =
    typeof task.selectionInstructions === "string"
      ? task.selectionInstructions
      : "";
  return {
    ...task,
    selectionInstructions: `${selectionInstructions}\n\nMock sandbox: treat tool results as authoritative evidence. Do not supplement with memory, assumed live prices, or external knowledge.`,
  };
}

/** Character counts vs RUNTIME_DEFAULTS — for tests and observability only; never mutates content. */
export function measurePromptEnvelope(
  messages: RuntimeAgentMessage[],
): PromptEnvelopeSizeReport {
  const systemChars =
    messages.find((m) => m.role === "system")?.content.length ?? 0;
  const userChars =
    messages.find((m) => m.role === "user")?.content.length ?? 0;
  const maxSystemChars = RUNTIME_DEFAULTS.prompt.maxSystemChars;
  const maxUserChars = RUNTIME_DEFAULTS.prompt.maxUserPayloadChars;
  return {
    systemChars,
    userChars,
    maxSystemChars,
    maxUserChars,
    exceedsSystem: systemChars > maxSystemChars,
    exceedsUser: userChars > maxUserChars,
  };
}

export function envelopeToMessages(
  envelope: PromptEnvelope,
  strategyContext: SessionStrategyContext,
): RuntimeAgentMessage[] {
  const phase = envelope.userPayload.phase as PipelinePhase;
  const strategyContextRequest = envelope.userPayload
    .strategyContextRequest as WorkerStrategyContextRequest;
  const sandboxMode = Boolean(envelope.userPayload.sandboxMode);
  const mockScenarioKind = envelope.userPayload.mockScenarioKind as
    | MockScenarioKind
    | null
    | undefined;
  const strategyPrompt = buildWorkerStrategyPromptContext(
    strategyContext,
    strategyContextRequest,
  );
  const presetGuidance = buildPresetBehaviorGuidance(
    strategyContext,
    phase,
    strategyContextRequest,
  );
  const task = augmentMockTask(
    envelope.userPayload.task as Record<string, unknown>,
    phase,
    sandboxMode,
  );

  const userContent = [
    `<trusted_strategy_facts>\n${strategyPrompt}\n</trusted_strategy_facts>`,
    presetGuidance.trim()
      ? `<trusted_strategy_guidance>\n${presetGuidance}\n</trusted_strategy_guidance>`
      : null,
    Object.keys(envelope.userPayload.engineResults as Record<string, unknown>)
      .length > 0
      ? `<engine_results>\n${JSON.stringify(envelope.userPayload.engineResults, null, 2)}\n</engine_results>`
      : null,
    `<task>\n${JSON.stringify(task, null, 2)}\n</task>`,
  ]
    .filter((block): block is string => block != null)
    .join("\n\n");

  const systemSections = [envelope.systemPrompt.trim()];
  if (sandboxMode) {
    systemSections.push("", renderSandboxSystemBlock(mockScenarioKind));
  }

  const messages: RuntimeAgentMessage[] = [
    { role: "system", content: systemSections.join("\n") },
    { role: "user", content: userContent },
  ];

  const sizes = measurePromptEnvelope(messages);
  logger.info(
    {
      phase,
      workerId: envelope.userPayload.workerId,
      ...sizes,
      hasStrategyGuidance: presetGuidance.trim().length > 0,
      hasEngineResults:
        Object.keys(envelope.userPayload.engineResults as Record<string, unknown>)
          .length > 0,
      taskKeys: Object.keys(envelope.userPayload.task as Record<string, unknown>).sort(),
    },
    "worker prompt assembled",
  );
  if (sizes.exceedsSystem || sizes.exceedsUser) {
    logger.warn(
      {
        phase,
        workerId: envelope.userPayload.workerId,
        ...sizes,
      },
      "worker prompt exceeds RUNTIME_DEFAULTS.prompt limits (content unchanged — shorten session config or worker task)",
    );
  }

  return messages;
}
