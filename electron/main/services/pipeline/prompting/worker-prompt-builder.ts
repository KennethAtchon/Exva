import type { PipelinePhase } from "@electron/shared/ai/ai-phase";
import type { WorkerStrategyContextRequest } from "@electron/shared/ai/ai-phase";
import { RUNTIME_DEFAULTS } from "@electron/shared/ai/ai-phase";
import type { SessionStrategyContext } from "@electron/shared/domain";
import { WORKER_GUIDANCE_MARKDOWN_MAX_CHARS } from "@electron/shared/domain";
import type { MockScenarioKind } from "@electron/shared/domain/mock-scenario";
import { MOCK_SCENARIO_LABELS } from "@electron/shared/domain/mock-scenario";
import { buildWorkerStrategyPromptContext } from "../prompting/strategy-prompt-context";
import type { LLMMessage } from "../../llm/llm-types";
import { createLogger } from "../../infra/log";
import { buildStrategyGuidance } from "./strategy-guidance";

const logger = createLogger("prompt-envelope");

export interface WorkerPromptInput {
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

export interface PromptSizeReport {
  systemChars: number;
  userChars: number;
  maxSystemChars: number;
  maxUserChars: number;
  exceedsSystem: boolean;
  exceedsUser: boolean;
}

export function buildWorkerPrompt(input: WorkerPromptInput): LLMMessage[] {
  const phase = input.phase;
  const strategyPrompt = buildWorkerStrategyPromptContext(
    input.strategyContext,
    input.strategyContextRequest,
  );
  const presetGuidance = buildStrategyGuidance(
    input.strategyContext,
    phase,
    input.strategyContextRequest,
  );
  const sandboxMode = input.sandboxMode ?? false;
  const task = augmentMockTask(
    input.task,
    phase,
    sandboxMode,
    input.mockScenarioKind,
  );
  const workerGuidance = renderWorkerGuidanceBlock(
    input.strategyContext.aiSettings.workerGuidanceMarkdown,
  );
  const engineResults = input.engineResults ?? {};
  const taskBlock = `<task>\n${JSON.stringify(task, null, 2)}\n</task>`;
  const userBlocks = [
    `<trusted_strategy_facts>\n${strategyPrompt}\n</trusted_strategy_facts>`,
    presetGuidance.trim()
      ? `<trusted_strategy_guidance>\n${presetGuidance}\n</trusted_strategy_guidance>`
      : null,
    workerGuidance,
  ].filter((block): block is string => block != null);
  const userWithoutEngineResults = [...userBlocks, taskBlock].join("\n\n");
  const engineResultsBlock = renderEngineResultsBlock(
    engineResults,
    RUNTIME_DEFAULTS.prompt.maxUserPayloadChars -
      userWithoutEngineResults.length -
      2,
  );
  const userContent = engineResultsBlock
    ? [...userBlocks, engineResultsBlock, taskBlock].join("\n\n")
    : userWithoutEngineResults;

  const systemSections = [input.basePromptMarkdown.trim()];
  if (sandboxMode) {
    systemSections.push("", renderSandboxSystemBlock(input.mockScenarioKind));
  }

  const messages: LLMMessage[] = [
    { role: "system", content: systemSections.join("\n") },
    { role: "user", content: userContent },
  ];

  const sizes = measureWorkerPrompt(messages);
  logger.info(
    {
      phase,
      workerId: input.workerId,
      ...sizes,
      hasStrategyGuidance: presetGuidance.trim().length > 0,
      hasWorkerGuidance: workerGuidance != null,
      hasEngineResults: Object.keys(engineResults).length > 0,
      taskKeys: Object.keys(input.task).sort(),
    },
    "worker prompt assembled",
  );
  if (sizes.exceedsSystem || sizes.exceedsUser) {
    logger.warn(
      {
        phase,
        workerId: input.workerId,
        ...sizes,
      },
      "worker prompt exceeds RUNTIME_DEFAULTS.prompt limits after engine-results truncation",
    );
  }

  return messages;
}

function renderEngineResultsBlock(
  engineResults: Record<string, unknown>,
  maxChars: number,
): string | null {
  if (Object.keys(engineResults).length === 0) return null;
  const content = JSON.stringify(engineResults, null, 2);
  const open = "<engine_results>\n";
  const close = "\n</engine_results>";
  const availableContentChars = maxChars - open.length - close.length;
  if (availableContentChars <= 0) {
    logger.warn(
      {
        originalChars: content.length,
        retainedChars: 0,
        cutChars: content.length,
      },
      "worker engine-results block omitted because protected prompt blocks consume the budget",
    );
    return null;
  }
  if (content.length <= availableContentChars)
    return `${open}${content}${close}`;

  const marker = "\n... engine results truncated";
  const retainedChars = Math.max(0, availableContentChars - marker.length);
  logger.warn(
    {
      originalChars: content.length,
      retainedChars,
      cutChars: content.length - retainedChars,
    },
    "worker engine-results block truncated to preserve protected prompt blocks",
  );
  return `${open}${content.slice(0, retainedChars)}${marker}${close}`;
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
  mockScenarioKind?: MockScenarioKind | null,
): Record<string, unknown> {
  if (!sandboxMode) return task;

  if (phase === "selector") {
    const selectionInstructions =
      typeof task.selectionInstructions === "string"
        ? task.selectionInstructions
        : "";
    return {
      ...task,
      selectionInstructions: `${selectionInstructions}\n\nMock sandbox: treat tool results as authoritative evidence. Do not supplement with memory, assumed live prices, or external knowledge.`,
    };
  }

  if (phase === "decision" && mockScenarioKind === "clean_breakout") {
    return {
      ...task,
      entryTimingHint:
        "Sandbox clean_breakout scenario: if review approved and quote is fresh, prefer enter_now unless a clear technical reason warrants waiting.",
    };
  }

  return task;
}

function renderWorkerGuidanceBlock(markdown: string): string | null {
  const trimmed = markdown.trim();
  if (!trimmed) return null;
  const content =
    trimmed.length > WORKER_GUIDANCE_MARKDOWN_MAX_CHARS
      ? `${trimmed.slice(0, WORKER_GUIDANCE_MARKDOWN_MAX_CHARS)}...`
      : trimmed;
  return `<session_worker_guidance>\n${content}\n</session_worker_guidance>`;
}

/** Character counts vs RUNTIME_DEFAULTS — for tests and observability only; never mutates content. */
export function measureWorkerPrompt(messages: LLMMessage[]): PromptSizeReport {
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
