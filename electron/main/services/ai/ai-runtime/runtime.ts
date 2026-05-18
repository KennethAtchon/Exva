import { z } from "zod";
import type { PipelinePhase } from "@electron/shared/ai/pipeline-phase";
import { AppError } from "@electron/shared/infra/errors";
import { tradeDecisionSchema, type InstrumentSelection } from "@/lib/schemas";
import type { AgentResult } from "./ai-runtime-types";
import type { ProviderRegistry } from "../provider-registry";
import type { SearchRegistry } from "../search";
import type { PromptAssetLoader } from "../prompt-asset-loader";
import type { SessionAiPhasesRepo } from "../../../db/repositories/session-ai-phases-repo";
import type { SessionRepo } from "../../../db/repositories/session-repo";
import type { WorkspacePreferencesRepo } from "../../../db/repositories/workspace-prefs-repo";
import type { ApiCallLogRepo } from "../../../db/repositories/api-call-log-repo";
import type { BrokerRoutingService } from "../../broker/broker-routing-service";
import type { BrokerRegistry } from "../../broker/broker-registry";
import type { SessionStrategyContextService } from "../../session/session-strategy-context-service";
import { createSearchTool } from "../tools/search-tool";
import { MockBrokerAdapter } from "../../broker/adapters/mock-adapter";
import type { MockOhlcvBar } from "../../broker/adapters/mock-adapter";
import { scenarioMockNews, type MockNewsItem } from "../tools/market-tools";
import { MOCK_REDDIT_POSTS } from "../tools/search-reddit-tool";
import { MOCK_TRENDING_SYMBOLS } from "../tools/trending-symbols-tool";
import { MockMarketSimulator } from "../../broker/mock/mock-market-simulator";
import { PipelineRuntime } from "../pipeline-runtime/pipeline-runtime";
import { PhaseConfigResolver } from "../pipeline-runtime/phase-config-resolver";
import { parseInstrumentSelection } from "./instrument-selection-parser";
import { tryParseDecisionFromText } from "./decision-parse";
import { buildSelectorPrepareStep } from "./selector-runtime-control";
import { resolveSelectorRoleSettings } from "@electron/shared/ai/ai-role-profile";
import type { ToolBuildContext } from "../pipeline-runtime/tool-factory-registry";
import { createLogger } from "../../infra/log";

const logger = createLogger("ai-runtime");

export type TradeDecision = z.infer<typeof tradeDecisionSchema>;

export class AiRuntime {
  private strategyContextService: SessionStrategyContextService | null;
  private readonly pipelineRuntime: PipelineRuntime;
  private readonly phaseConfigResolver: PhaseConfigResolver;

  constructor(
    private readonly registry: ProviderRegistry,
    private readonly searchRegistry: SearchRegistry,
    private readonly promptLoader: PromptAssetLoader,
    private readonly aiPhasesRepo: SessionAiPhasesRepo,
    private readonly sessionRepo: SessionRepo,
    private readonly workspacePrefsRepo: WorkspacePreferencesRepo,
    private readonly apiCallLogRepo: ApiCallLogRepo,
    private readonly brokerRouting?: BrokerRoutingService,
    private readonly brokerRegistry?: BrokerRegistry,
    strategyContextService?: SessionStrategyContextService,
  ) {
    this.strategyContextService = strategyContextService ?? null;
    this.phaseConfigResolver = new PhaseConfigResolver(aiPhasesRepo);
    this.pipelineRuntime = new PipelineRuntime({
      providerRegistry: registry,
      phaseConfigResolver: this.phaseConfigResolver,
      promptLoader,
      strategyContextService: strategyContextService!,
    });
  }

  setStrategyContextService(strategyContextService: SessionStrategyContextService): void {
    this.strategyContextService = strategyContextService;
    (this.pipelineRuntime as unknown as { deps: { strategyContextService: SessionStrategyContextService } }).deps.strategyContextService = strategyContextService;
  }

  async runPhase<TInput, TOutput>(
    phase: PipelinePhase,
    sessionId: string,
    input: TInput,
    cycleId?: string | null,
    tradeId?: string | null,
  ): Promise<AgentResult<TOutput>> {
    if (!sessionId) throw new AppError("Session id is required for phase execution", "VALIDATION_FAILED");

    const svcCtx = this.requireStrategyContextService();
    const searchProviderId = this.resolveSearchProviderId(sessionId);
    const mockCtx = await this.getMockContext(sessionId);
    const instrumentClasses = this.sessionRepo.requireById(sessionId).instrumentClasses;
    const strategyContext = svcCtx.get(sessionId);

    const toolContext: ToolBuildContext = {
      sessionId,
      cycleId: cycleId ?? null,
      tradeId: tradeId ?? null,
      searchProviderId,
      instrumentClasses,
      apiCallLogRepo: this.apiCallLogRepo,
      searchRegistry: this.searchRegistry,
      brokerRouting: this.brokerRouting,
      brokerRegistry: this.brokerRegistry,
      strategyContext,
      maxDataSpendUsd: strategyContext.riskConfig.maxDataSpendUsd,
      getMockOhlcv: mockCtx.getMockOhlcv,
      mockNewsData: mockCtx.mockNewsData,
      mockRedditData: mockCtx.mockRedditData,
      mockTrendingData: mockCtx.mockTrendingData,
      isMockSession: mockCtx.isMock,
      resolveSearchTool: this.resolveSearchTool.bind(this),
    };

    // Selector needs a prepareStep and terminal tools
    if (phase === "selector") {
      const selectorSettings = resolveSelectorRoleSettings(null);
      const harnessAvail = {
        searchWeb: Boolean(searchProviderId),
        fetchUrl: true,
        searchReddit: true,
        trendingSymbols: true,
        getNews: this.hasBrokerWiring() && (Boolean(searchProviderId) || Boolean(mockCtx.mockNewsData)),
        getQuote: this.hasBrokerWiring(),
        getOhlcv: this.hasBrokerWiring(),
        submitCandidates: true,
      };
      const prepareStep = buildSelectorPrepareStep(harnessAvail, selectorSettings);

      return this.pipelineRuntime.run<TInput, TOutput>({
        phase,
        sessionId,
        input,
        cycleId,
        tradeId,
        toolContext,
        prepareStep,
        terminalToolNames: ["submit_candidates"],
      });
    }

    return this.pipelineRuntime.run<TInput, TOutput>({
      phase,
      sessionId,
      input,
      cycleId,
      tradeId,
      toolContext,
    });
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
      return { isMock: false, getMockOhlcv: undefined, mockNewsData: undefined, mockRedditData: undefined, mockTrendingData: undefined };
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

  private requireStrategyContextService(): SessionStrategyContextService {
    if (!this.strategyContextService) {
      throw new AppError("Strategy context service is not configured.", "UNKNOWN");
    }
    return this.strategyContextService;
  }
}
