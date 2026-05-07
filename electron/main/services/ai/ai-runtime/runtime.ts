import { tool, type ToolSet } from "ai";
import { z } from "zod";
import type { AgentRole } from "@/lib/types";
import { AppError } from "@electron/shared/errors";
import type { SessionAiRolesRepo } from "../../../db/repositories/session-ai-roles-repo";
import type { ApiCallLogRepo } from "../../../db/repositories/api-call-log-repo";
import type { SessionRepo } from "../../../db/repositories/session-repo";
import type { WorkspacePreferencesRepo } from "../../../db/repositories/workspace-prefs-repo";
import {
  instrumentSelectionSchema,
  tradeDecisionSchema,
  type InstrumentSelection,
} from "@/lib/schemas";
import type { AgentResult, RuntimeAgentMessage } from "./ai-runtime-types";
import { ROLE_HARNESS_CAPS } from "./ai-runtime-types";
import type { PromptAssetLoader } from "../prompt-asset-loader";
import type { ProviderRegistry } from "../provider-registry";
import type { SearchRegistry } from "../search";
import type { SessionStrategyContextService } from "../../session/session-strategy-context-service";
import { createSearchTool } from "../tools/search-tool";
import { createMarketTools } from "../tools/market-tools";
import { buildRoleTools } from "./role-tools";
import { AgentPromptPackBuilder, type AgentTaskPrompt } from "../prompt-pack-builder";
import type { BrokerRoutingService } from "../../broker/broker-routing-service";
import type { BrokerRegistry } from "../../broker/broker-registry";
import { createLogger } from "../../infra/log";
import { textMeta } from "../../infra/log-safety";
import { toRunFromTrace, buildTraceMessage } from "./runtime-trace";
import { withProviderRetry } from "./runtime-retry";
import { analysisLabelsForStrategy, resolvePromptForRole } from "./runtime-prompt";
import { parseInstrumentSelection } from "./instrument-selection-parser";

const logger = createLogger("ai-runtime");

export interface ResearcherInput {
  instrumentSymbol: string;
  context?: string;
}

export interface ReviewerInput {
  instrumentSymbol: string;
  technicalAnalysis: string;
  fundamentalAnalysis: string;
}

export interface DecisionInput extends ReviewerInput {
  review: string;
  maxPositionUsd: number;
}

export type TradeDecision = z.infer<typeof tradeDecisionSchema>;


export class AiRuntime {
  private strategyContextService: SessionStrategyContextService | null;

  constructor(
    private readonly registry: ProviderRegistry,
    private readonly searchRegistry: SearchRegistry,
    private readonly promptLoader: PromptAssetLoader,
    private readonly aiRolesRepo: SessionAiRolesRepo,
    private readonly sessionRepo: SessionRepo,
    private readonly workspacePrefsRepo: WorkspacePreferencesRepo,
    private readonly apiCallLogRepo: ApiCallLogRepo,
    private readonly brokerRouting?: BrokerRoutingService,
    private readonly brokerRegistry?: BrokerRegistry,
    strategyContextService?: SessionStrategyContextService,
  ) {
    this.strategyContextService = strategyContextService ?? null;
  }

  setStrategyContextService(strategyContextService: SessionStrategyContextService): void {
    this.strategyContextService = strategyContextService;
  }

  async runAnalyst(
    input: ResearcherInput,
    role: "technical" | "fundamental",
    sessionId?: string,
  ): Promise<AgentResult<string>> {
    if (!sessionId) throw new AppError("Session id is required for AI role execution", "VALIDATION_FAILED");
    const agentRole: AgentRole = role === "technical" ? "analyst_technical" : "analyst_fundamental";
    const userPrompt = `Instrument: ${input.instrumentSymbol}\nContext: ${input.context ?? "None"}`;
    const prompt = textMeta(userPrompt);
    logger.info(
      {
        sessionId,
        role: agentRole,
        instrumentSymbol: input.instrumentSymbol,
        promptChars: prompt.length,
        promptTooLong: prompt.tooLong,
        promptLooksSensitive: prompt.looksSensitive,
      },
      "ai role start",
    );
    return this.runRole(sessionId, agentRole, userPrompt);
  }

  async runReviewer(input: ReviewerInput, sessionId?: string): Promise<AgentResult<string>> {
    if (!sessionId) throw new AppError("Session id is required for AI role execution", "VALIDATION_FAILED");
    const labels = this.analysisLabels(sessionId);
    const prompt = `Instrument: ${input.instrumentSymbol}\n\n${labels.first}:\n${input.technicalAnalysis}\n\n${labels.second}:\n${input.fundamentalAnalysis}`;
    const promptInfo = textMeta(prompt);
    logger.info(
      {
        sessionId,
        role: "reviewer",
        instrumentSymbol: input.instrumentSymbol,
        promptChars: promptInfo.length,
        promptTooLong: promptInfo.tooLong,
      },
      "ai role start",
    );
    return this.runRole(sessionId, "reviewer", prompt);
  }

  async runDecisionMaker(input: DecisionInput, sessionId?: string): Promise<AgentResult<TradeDecision>> {
    if (!sessionId) throw new AppError("Session id is required for AI role execution", "VALIDATION_FAILED");
    const labels = this.analysisLabels(sessionId);
    const prompt = `Instrument: ${input.instrumentSymbol}
Max position USD: ${input.maxPositionUsd}

${labels.first}:
${input.technicalAnalysis}

${labels.second}:
${input.fundamentalAnalysis}

Review:
${input.review}`;
    const promptInfo = textMeta(prompt);
    logger.info(
      {
        sessionId,
        role: "decision_maker",
        instrumentSymbol: input.instrumentSymbol,
        promptChars: promptInfo.length,
        promptTooLong: promptInfo.tooLong,
      },
      "ai role start",
    );
    return this.runDecisionRole(sessionId, prompt);
  }

  async runInstrumentSelector(
    sessionId: string,
    selectionInstructions: string,
    cycleId?: string | null,
  ): Promise<AgentResult<InstrumentSelection>> {
    const role = "instrument_selector" as const;
    const config = this.aiRolesRepo.requireByRole(sessionId, role);
    const adapter = await this.registry.get(config.providerKey);
    const promptPack = this.buildPromptPack(sessionId, role, config, {
      bodyMarkdown: selectionInstructions,
      cycleId: cycleId ?? null,
    });
    const promptInfo = textMeta(promptPack.messages[1]?.content ?? selectionInstructions);
    logger.info(
      {
        sessionId,
        role,
        cycleId: cycleId ?? null,
        promptChars: promptInfo.length,
        promptTooLong: promptInfo.tooLong,
      },
      "ai role start",
    );

    const submitCandidates = tool({
      description: "Submit the final shortlist when research is complete.",
      inputSchema: instrumentSelectionSchema,
      execute: async (candidates: InstrumentSelection) => candidates,
    });

    const tools: ToolSet = {
      submit_candidates: submitCandidates,
    };
    if (config.webSearchEnabled) {
      tools.search_web = await this.resolveSearchTool(sessionId, { cycleId: cycleId ?? null });
    }
    if (this.brokerRouting && this.brokerRegistry) {
      const marketTools = createMarketTools({
        sessionId,
        brokerRegistry: this.brokerRegistry,
        brokerAccountIdByClass: (instrumentClass) => {
          try {
            return this.brokerRouting?.resolveBrokerAccountId(sessionId, instrumentClass) ?? null;
          } catch {
            return null;
          }
        },
        searchRegistry: this.searchRegistry,
        searchProviderId: this.resolveSearchProviderId(sessionId),
      });
      tools.get_quote = marketTools.get_quote;
      tools.get_ohlcv = marketTools.get_ohlcv;
      tools.get_news = marketTools.get_news;
    }

    const caps = ROLE_HARNESS_CAPS[role];

    const messages: RuntimeAgentMessage[] = promptPack.messages;

    const trace = await withProviderRetry(() =>
      adapter.runAgent({
        model: config.modelId,
        messages,
        tools,
        maxSteps: caps.maxSteps,
        spendLimitUsd: caps.spendUsd,
        temperature: config.temperature,
        maxTokens: config.maxTokens,
      }),
    );

    const selection = parseInstrumentSelection(trace);
    const run = toRunFromTrace(role, config.modelId, config.providerKey, trace);
    logger.info(
      {
        sessionId,
        role,
        cycleId: cycleId ?? null,
        inputTokens: run.input_tokens,
        outputTokens: run.output_tokens,
        durationMs: run.duration_ms,
        costUsd: run.cost_usd,
      },
      "ai role complete",
    );
    return {
      run,
      message: buildTraceMessage({
        run,
        role,
        config,
        sessionId,
        tradeId: null,
        cycleId: cycleId ?? null,
        trace,
        outputJson: JSON.stringify(selection),
        outputSchemaName: "instrumentSelection",
        strategySnapshotJson: JSON.stringify(promptPack.strategySnapshot),
        marketSnapshotJson: promptPack.marketSnapshotJson,
      }),
      output: selection,
    };
  }

  async runRole(
    sessionId: string,
    role: AgentRole,
    userPrompt: string,
    opts?: { cycleId?: string | null },
  ): Promise<AgentResult<string>> {
    const config = this.aiRolesRepo.requireByRole(sessionId, role);
    const adapter = await this.registry.get(config.providerKey);
    const promptPack = this.buildPromptPack(sessionId, role, config, {
      bodyMarkdown: userPrompt,
      cycleId: opts?.cycleId ?? null,
    });
    const tools = await buildRoleTools({
      sessionId,
      role,
      webSearchEnabled: config.webSearchEnabled,
      cycleId: opts?.cycleId ?? null,
      resolveSearchTool: this.resolveSearchTool.bind(this),
      searchRegistry: this.searchRegistry,
      brokerRouting: this.brokerRouting,
      brokerRegistry: this.brokerRegistry,
      resolveSearchProviderId: this.resolveSearchProviderId.bind(this),
    });
    const caps = ROLE_HARNESS_CAPS[role];

    const messages: RuntimeAgentMessage[] = promptPack.messages;

    const trace = await withProviderRetry(() =>
      adapter.runAgent({
          model: config.modelId,
          messages,
          tools,
        maxSteps: caps.maxSteps,
        spendLimitUsd: caps.spendUsd,
        temperature: config.temperature,
        maxTokens: config.maxTokens,
      }),
    );

    const run = toRunFromTrace(role, config.modelId, config.providerKey, trace);
    logger.info(
      {
        sessionId,
        role,
        cycleId: opts?.cycleId ?? null,
        inputTokens: run.input_tokens,
        outputTokens: run.output_tokens,
        durationMs: run.duration_ms,
        costUsd: run.cost_usd,
      },
      "ai role complete",
    );
    return {
      run,
      message: buildTraceMessage({
        run,
        role,
        config,
        sessionId,
        tradeId: null,
        cycleId: opts?.cycleId ?? null,
        trace,
        outputJson: JSON.stringify({ text: trace.assistantText }),
        outputSchemaName: null,
        strategySnapshotJson: JSON.stringify(promptPack.strategySnapshot),
        marketSnapshotJson: promptPack.marketSnapshotJson,
      }),
      output: trace.assistantText,
    };
  }

  async runDecisionRole(sessionId: string, userPrompt: string, cycleId?: string | null): Promise<AgentResult<TradeDecision>> {
    const role: AgentRole = "decision_maker";
    const config = this.aiRolesRepo.requireByRole(sessionId, role);
    const adapter = await this.registry.get(config.providerKey);
    const promptPack = this.buildPromptPack(sessionId, role, config, {
      bodyMarkdown: userPrompt,
      cycleId: cycleId ?? null,
    });
    const caps = ROLE_HARNESS_CAPS[role];

    const messages: RuntimeAgentMessage[] = promptPack.messages;

    const trace = await withProviderRetry(() =>
      adapter.runAgent({
        model: config.modelId,
        messages,
        maxSteps: caps.maxSteps,
        spendLimitUsd: caps.spendUsd,
        temperature: config.temperature,
        maxTokens: config.maxTokens,
        schema: tradeDecisionSchema,
      }),
    );

    const obj = trace.structuredOutput;
    if (!obj) {
      throw new AppError("Decision maker returned no structured trade decision.", "VALIDATION_FAILED");
    }

    const run = toRunFromTrace(role, config.modelId, config.providerKey, trace);
    logger.info(
      {
        sessionId,
        role,
        cycleId: cycleId ?? null,
        inputTokens: run.input_tokens,
        outputTokens: run.output_tokens,
        durationMs: run.duration_ms,
        costUsd: run.cost_usd,
      },
      "ai role complete",
    );
    return {
      run,
      message: buildTraceMessage({
        run,
        role,
        config,
        sessionId,
        tradeId: null,
        cycleId: cycleId ?? null,
        trace,
        outputJson: JSON.stringify(obj),
        outputSchemaName: "tradeDecision",
        strategySnapshotJson: JSON.stringify(promptPack.strategySnapshot),
        marketSnapshotJson: promptPack.marketSnapshotJson,
        parseFallback: trace.parseFallback,
      }),
      output: obj,
    };
  }

  private buildPromptPack(
    sessionId: string,
    role: AgentRole,
    config: { promptSource: "default" | "session_override"; promptMarkdown: string },
    task: AgentTaskPrompt,
  ) {
    const basePromptMarkdown = this.resolvePrompt(sessionId, role, config.promptSource, config.promptMarkdown);
    return new AgentPromptPackBuilder(this.requireStrategyContextService()).build({
      sessionId,
      role,
      basePromptMarkdown,
      task,
    });
  }

  private async resolveSearchTool(sessionId: string, context?: { cycleId?: string | null; tradeId?: string | null }) {
    const searchProviderId = this.resolveSearchProviderId(sessionId);
    if (!searchProviderId) {
      throw new AppError(
        "Session cannot enable web search because no search provider is configured.",
        "SEARCH_PROVIDER_REQUIRED",
      );
    }

    return createSearchTool({
      sessionId,
      searchProviderId,
      searchRegistry: this.searchRegistry,
      apiCallLogRepo: this.apiCallLogRepo,
      cycleId: context?.cycleId ?? null,
      tradeId: context?.tradeId ?? null,
      maxDataSpendUsd: this.requireStrategyContextService().get(sessionId).riskConfig.maxDataSpendUsd,
    });
  }

  private resolveSearchProviderId(sessionId: string): string | null {
    const session = this.sessionRepo.requireById(sessionId);
    const prefs = this.workspacePrefsRepo.get();
    return session.defaultSearchProviderId ?? prefs.defaultSearchProviderId;
  }

  private resolvePrompt(sessionId: string, role: AgentRole, promptSource: "default" | "session_override", promptMarkdown: string): string {
    const strategyType = this.strategyContextService?.get(sessionId).profile.strategyType;
    return resolvePromptForRole({
      role,
      promptSource,
      promptMarkdown,
      strategyType,
      promptLoader: this.promptLoader,
    });
  }

  private analysisLabels(sessionId: string): { first: string; second: string } {
    const strategyType = this.requireStrategyContextService().get(sessionId).profile.strategyType;
    return analysisLabelsForStrategy(strategyType);
  }

  private requireStrategyContextService(): SessionStrategyContextService {
    if (!this.strategyContextService) {
      throw new AppError("Strategy context service is not configured.", "UNKNOWN");
    }
    return this.strategyContextService;
  }
}
