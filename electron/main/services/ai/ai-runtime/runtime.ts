import { z } from "zod";
import type { AgentRole } from "@/lib/types";
import { AppError } from "@electron/shared/errors";
import type { SessionAiRolesRepo } from "../../../db/repositories/session-ai-roles-repo";
import type { ApiCallLogRepo } from "../../../db/repositories/api-call-log-repo";
import type { SessionRepo } from "../../../db/repositories/session-repo";
import type { WorkspacePreferencesRepo } from "../../../db/repositories/workspace-prefs-repo";
import { tradeDecisionSchema, type InstrumentSelection } from "@/lib/schemas";
import type { AgentResult, RuntimeAgentMessage } from "./ai-runtime-types";
import { ROLE_HARNESS_CAPS } from "./ai-runtime-types";
import {
  buildHarnessToolSet,
  harnessToolAvailabilityForRole,
  type HarnessToolAvailability,
} from "./harness-tools";
import type { PromptAssetLoader } from "../prompt-asset-loader";
import type { ProviderRegistry } from "../provider-registry";
import type { SearchRegistry } from "../search";
import type { SessionStrategyContextService } from "../../session/session-strategy-context-service";
import { createSearchTool } from "../tools/search-tool";
import { AgentPromptPackBuilder, type AgentTaskPrompt } from "../prompt-pack-builder";
import type { BrokerRoutingService } from "../../broker/broker-routing-service";
import type { BrokerRegistry } from "../../broker/broker-registry";
import { createLogger } from "../../infra/log";
import { textMeta } from "../../infra/log-safety";
import { toRunFromTrace, buildTraceMessage } from "./runtime-trace";
import { withProviderRetry } from "./runtime-retry";
import { analysisLabelsForStrategy, resolvePromptForRole } from "./runtime-prompt";
import { parseInstrumentSelection } from "./instrument-selection-parser";
import { tryParseDecisionFromText } from "./decision-parse";
import { MockBrokerAdapter } from "../../broker/adapters/mock-adapter";
import type { MockOhlcvBar } from "../../broker/adapters/mock-adapter";
import { scenarioMockNews, type MockNewsItem } from "../tools/market-tools";
import { MOCK_REDDIT_POSTS } from "../tools/search-reddit-tool";
import { MOCK_TRENDING_SYMBOLS } from "../tools/trending-symbols-tool";
import { MockMarketSimulator } from "../../broker/mock/mock-market-simulator";

const logger = createLogger("ai-runtime");

function resolveTemperature(modelId: string, configured: number | undefined): number | undefined {
  if (configured == null) return undefined;
  const id = modelId.toLowerCase();
  // OpenRouter/OpenCode model IDs use "provider/model" format.
  // @ai-sdk/openai treats any model not starting with gpt-3/4/5-chat as a reasoning model,
  // so it warns about temperature for every non-OpenAI model. Skip it for all slash-namespaced IDs.
  if (id.includes("/")) return undefined;
  if (
    id.includes("gpt-5") ||
    id.includes("o1") ||
    id.includes("o3") ||
    id.includes("o4") ||
    id.includes("reasoning")
  ) {
    return undefined;
  }
  return configured;
}

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
    const instrumentClasses = this.sessionRepo.requireById(sessionId).instrumentClasses;
    const adapter = await this.registry.get(config.providerKey);
    const searchProviderId = this.resolveSearchProviderId(sessionId);
    const mockCtx = await this.getMockContext(sessionId);
    const harnessAvail = harnessToolAvailabilityForRole(
      role,
      searchProviderId,
      this.hasBrokerWiring(),
      Boolean(mockCtx.mockNewsData),
    );
    const promptPack = await this.buildPromptPack(sessionId, role, config, {
      bodyMarkdown: selectionInstructions,
      cycleId: cycleId ?? null,
    }, harnessAvail);
    const promptInfo = textMeta(
      promptPack.messages.map((m) => m.content).join("\n\n") || selectionInstructions,
    );
    logger.info(
      {
        sessionId,
        role,
        cycleId: cycleId ?? null,
        promptChars: promptInfo.length,
        promptTooLong: promptInfo.tooLong,
        sandboxMode: mockCtx.isMock,
        searchProviderId,
        toolAvailability: harnessAvail,
      },
      "ai role start",
    );

    const tools = await buildHarnessToolSet({
      sessionId,
      role,
      cycleId: cycleId ?? null,
      availability: harnessAvail,
      searchProviderId,
      resolveSearchTool: this.resolveSearchTool.bind(this),
      searchRegistry: this.searchRegistry,
      apiCallLogRepo: this.apiCallLogRepo,
      brokerRouting: this.brokerRouting,
      brokerRegistry: this.brokerRegistry,
      maxDataSpendUsd: promptPack.riskPolicy.maxDataSpendUsd,
      instrumentClasses,
      getMockOhlcv: mockCtx.getMockOhlcv,
      mockNewsData: mockCtx.mockNewsData,
      mockRedditData: mockCtx.mockRedditData,
      mockTrendingData: mockCtx.mockTrendingData,
      isMockSession: mockCtx.isMock,
    });

    const caps = ROLE_HARNESS_CAPS[role];

    const messages: RuntimeAgentMessage[] = promptPack.messages;

    const trace = await withProviderRetry(
      (abortSignal) =>
        adapter.runAgent({
          model: config.modelId,
          role,
          messages,
          tools,
          maxSteps: caps.maxSteps,
          spendLimitUsd: caps.spendUsd,
          temperature: resolveTemperature(config.modelId, config.temperature),
          maxTokens: config.maxTokens,
          abortSignal,
          terminalToolNames: ["submit_candidates"],
          prepareStep: harnessAvail.searchWeb
            ? ({ stepNumber }: { stepNumber: number }) => {
                if (stepNumber !== 0) return {};
                return {
                  activeTools: ["search_web"],
                  toolChoice: { type: "tool" as const, toolName: "search_web" as const },
                };
              }
            : undefined,
        }),
      { providerType: adapter.providerType, modelId: config.modelId, role, sessionId, cycleId: cycleId ?? null },
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
    const instrumentClasses = this.sessionRepo.requireById(sessionId).instrumentClasses;
    const adapter = await this.registry.get(config.providerKey);
    const searchProviderId = this.resolveSearchProviderId(sessionId);
    const mockCtx = await this.getMockContext(sessionId);
    const harnessAvail = harnessToolAvailabilityForRole(
      role,
      searchProviderId,
      this.hasBrokerWiring(),
      Boolean(mockCtx.mockNewsData),
    );
    const promptPack = await this.buildPromptPack(sessionId, role, config, {
      bodyMarkdown: userPrompt,
      cycleId: opts?.cycleId ?? null,
    }, harnessAvail);
    const tools = await buildHarnessToolSet({
      sessionId,
      role,
      cycleId: opts?.cycleId ?? null,
      availability: harnessAvail,
      searchProviderId,
      resolveSearchTool: this.resolveSearchTool.bind(this),
      searchRegistry: this.searchRegistry,
      apiCallLogRepo: this.apiCallLogRepo,
      brokerRouting: this.brokerRouting,
      brokerRegistry: this.brokerRegistry,
      maxDataSpendUsd: promptPack.riskPolicy.maxDataSpendUsd,
      instrumentClasses,
      getMockOhlcv: mockCtx.getMockOhlcv,
      mockNewsData: mockCtx.mockNewsData,
      mockRedditData: mockCtx.mockRedditData,
      mockTrendingData: mockCtx.mockTrendingData,
      isMockSession: mockCtx.isMock,
    });
    const caps = ROLE_HARNESS_CAPS[role];

    const messages: RuntimeAgentMessage[] = promptPack.messages;

    const trace = await withProviderRetry(
      (abortSignal) =>
        adapter.runAgent({
          model: config.modelId,
          role,
          messages,
          tools,
          maxSteps: caps.maxSteps,
          spendLimitUsd: caps.spendUsd,
          temperature: resolveTemperature(config.modelId, config.temperature),
          maxTokens: config.maxTokens,
          abortSignal,
        }),
      { providerType: adapter.providerType, modelId: config.modelId, role, sessionId, cycleId: opts?.cycleId ?? null },
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
    const searchProviderId = this.resolveSearchProviderId(sessionId);
    const mockCtx = await this.getMockContext(sessionId);
    const harnessAvail = harnessToolAvailabilityForRole(
      role,
      searchProviderId,
      this.hasBrokerWiring(),
      Boolean(mockCtx.mockNewsData),
    );
    const promptPack = await this.buildPromptPack(sessionId, role, config, {
      bodyMarkdown: userPrompt,
      cycleId: cycleId ?? null,
    }, harnessAvail);
    const caps = ROLE_HARNESS_CAPS[role];

    const messages: RuntimeAgentMessage[] = promptPack.messages;

    const trace = await withProviderRetry(
      (abortSignal) =>
        adapter.runAgent({
          model: config.modelId,
          role,
          messages,
          maxSteps: caps.maxSteps,
          spendLimitUsd: caps.spendUsd,
          temperature: resolveTemperature(config.modelId, config.temperature),
          maxTokens: config.maxTokens,
          abortSignal,
          schema: tradeDecisionSchema,
        }),
      { providerType: adapter.providerType, modelId: config.modelId, role, sessionId, cycleId: cycleId ?? null },
    );

    let obj = trace.structuredOutput;
    let parsedFromAssistantText = false;
    if (!obj) {
      const fallback = tryParseDecisionFromText(trace.assistantText);
      if (!fallback) {
        throw new AppError(
          `Decision maker returned no parseable trade decision. textPreview=${trace.assistantText.slice(0, 200)}`,
          "VALIDATION_FAILED",
        );
      }
      obj = fallback;
      parsedFromAssistantText = true;
      logger.warn(
        {
          sessionId,
          role,
          cycleId: cycleId ?? null,
          textLength: trace.assistantText.length,
        },
        "decision maker structured output missing; parsed from assistant text",
      );
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
        parseFallback: parsedFromAssistantText || trace.parseFallback,
      }),
      output: obj,
    };
  }

  private async buildPromptPack(
    sessionId: string,
    role: AgentRole,
    config: { promptSource: "default" | "session_override"; promptMarkdown: string },
    task: AgentTaskPrompt,
    harnessToolAvailability: HarnessToolAvailability,
  ) {
    const basePromptMarkdown = this.resolvePrompt(sessionId, role, config.promptSource, config.promptMarkdown);
    const sandboxMode = await this.isMockSession(sessionId);
    return new AgentPromptPackBuilder(this.requireStrategyContextService()).build({
      sessionId,
      role,
      basePromptMarkdown,
      task,
      harnessToolAvailability,
      sandboxMode,
    });
  }

  private async isMockSession(sessionId: string): Promise<boolean> {
    if (!this.brokerRouting || !this.brokerRegistry) return false;
    try {
      const accountId = this.brokerRouting.resolveBrokerAccountId(sessionId, "stock");
      return this.brokerRegistry.isMockAccount(accountId);
    } catch {
      try {
        const accountId = this.brokerRouting.resolveBrokerAccountId(sessionId, "crypto");
        return this.brokerRegistry.isMockAccount(accountId);
      } catch {
        return false;
      }
    }
  }

  private async resolveMockAdapter(sessionId: string): Promise<MockBrokerAdapter | null> {
    if (!this.brokerRouting || !this.brokerRegistry) return null;
    for (const cls of ["stock", "crypto", "futures", "prediction_market"] as const) {
      try {
        const accountId = this.brokerRouting.resolveBrokerAccountId(sessionId, cls);
        const adapter = await this.brokerRegistry.get(accountId);
        if (adapter.brokerType === "mock") return adapter as MockBrokerAdapter;
      } catch {
        // try next class
      }
    }
    return null;
  }

  private async getMockContext(sessionId: string): Promise<{
    isMock: boolean;
    getMockOhlcv: ((symbol: string, timeframe?: string) => MockOhlcvBar[]) | undefined;
    mockNewsData: MockNewsItem[] | undefined;
    mockRedditData: typeof MOCK_REDDIT_POSTS | undefined;
    mockTrendingData: typeof MOCK_TRENDING_SYMBOLS | undefined;
  }> {
    const mockAdapter = await this.resolveMockAdapter(sessionId);
    if (!mockAdapter) {
      return {
        isMock: false,
        getMockOhlcv: undefined,
        mockNewsData: undefined,
        mockRedditData: undefined,
        mockTrendingData: undefined,
      };
    }
    const kind = mockAdapter.getScenarioKind();
    const fixtures = kind ? MockMarketSimulator.fixturesFor(kind) : null;
    return {
      isMock: true,
      getMockOhlcv: (symbol: string, timeframe?: string) => mockAdapter.getMockOhlcv(symbol, timeframe),
      mockNewsData: fixtures?.news ?? scenarioMockNews(mockAdapter.getScenarioBias()),
      mockRedditData: (fixtures?.redditPosts ?? MOCK_REDDIT_POSTS) as typeof MOCK_REDDIT_POSTS,
      mockTrendingData: (fixtures?.trendingSymbols ?? MOCK_TRENDING_SYMBOLS) as typeof MOCK_TRENDING_SYMBOLS,
    };
  }

  private hasBrokerWiring(): boolean {
    return Boolean(this.brokerRouting && this.brokerRegistry);
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
    const discoveryMode = this.strategyContextService?.get(sessionId).researchPosture.discoveryMode;
    return resolvePromptForRole({
      role,
      promptSource,
      promptMarkdown,
      discoveryMode,
      promptLoader: this.promptLoader,
    });
  }

  private analysisLabels(sessionId: string): { first: string; second: string } {
    const discoveryMode = this.requireStrategyContextService().get(sessionId).researchPosture.discoveryMode;
    return analysisLabelsForStrategy(discoveryMode);
  }

  private requireStrategyContextService(): SessionStrategyContextService {
    if (!this.strategyContextService) {
      throw new AppError("Strategy context service is not configured.", "UNKNOWN");
    }
    return this.strategyContextService;
  }
}
