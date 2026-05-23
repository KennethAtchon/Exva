import { tool, type ToolSet } from "ai";
import type { z } from "zod";
import type { ToolId } from "@electron/shared/ai/pipeline-phase";
import { AppError } from "@electron/shared/infra/errors";
import type { InstrumentClass } from "@/lib/types";
import type { ApiCallLogRepo } from "../../../db/repositories/system/api-call-log-repo";
import type { SearchRegistry } from "../../search";
import { createSearchTool, createMockSearchTool } from "../../tools/search-tool";
import type { BrokerRoutingService } from "../../broker/broker-routing-service";
import type { BrokerRegistry } from "../../broker/broker-registry";
import type { MockOhlcvBar } from "../../broker/adapters/mock-adapter";
import type { MockNewsItem } from "../../tools/market-tools";
import type { MockWebSearchItem } from "../../broker/mock/mock-discovery-fixtures";
import { createMarketTools } from "../../tools/market-tools";
import { createFetchUrlTool } from "../../tools/fetch-url-tool";
import { createSearchRedditTool } from "../../tools/search-reddit-tool";
import { createTrendingSymbolsTool } from "../../tools/trending-symbols-tool";
import type { MOCK_REDDIT_POSTS } from "../../tools/search-reddit-tool";
import type { MOCK_TRENDING_SYMBOLS } from "../../tools/trending-symbols-tool";
import type { SessionStrategyContext } from "@electron/shared/domain";
import type { MockScenarioKind } from "@electron/shared/domain/mock-scenario";
import type { WorkerToolConfig } from "@electron/shared/ai/pipeline-config";

export const SUPPORTED_TOOL_IDS = [
  "search_web",
  "fetch_url",
  "search_reddit",
  "get_trending_symbols",
  "get_quote",
  "get_ohlcv",
  "get_news",
] as const;

export const DEFAULT_TERMINAL_TOOL_DESCRIPTION =
  "Submit your final structured result. Call this exactly once when your analysis is complete; the arguments must match the required schema.";

/** Runtime configuration for a worker's terminal output tool. */
export interface TerminalOutputToolSpec {
  name: string;
  description: string;
  schema: z.ZodType<unknown>;
}

export interface ToolBuildContext {
  sessionId: string;
  cycleId: string | null;
  tradeId?: string | null;
  searchProviderId: string | null;
  instrumentClasses: InstrumentClass[];
  apiCallLogRepo: ApiCallLogRepo;
  searchRegistry: SearchRegistry;
  brokerRouting?: BrokerRoutingService;
  brokerRegistry?: BrokerRegistry;
  strategyContext: SessionStrategyContext;
  maxDataSpendUsd?: number | null;
  getMockOhlcv?: (symbol: string, timeframe?: string) => MockOhlcvBar[];
  mockNewsData?: MockNewsItem[];
  mockRedditData?: typeof MOCK_REDDIT_POSTS;
  mockTrendingData?: typeof MOCK_TRENDING_SYMBOLS;
  mockWebSearchData?: MockWebSearchItem[];
  mockUrlContent?: Record<string, string>;
  mockPrimarySymbols?: string[];
  mockScenarioKind?: MockScenarioKind;
  isMockSession?: boolean;
}

export type HarnessToolAvailability = {
  searchWeb: boolean;
  fetchUrl: boolean;
  searchReddit: boolean;
  trendingSymbols: boolean;
  getNews: boolean;
  getQuote: boolean;
  getOhlcv: boolean;
};

export async function buildToolSet(
  toolIds: readonly ToolId[],
  ctx: ToolBuildContext,
  outputTool?: TerminalOutputToolSpec,
  toolConfig?: WorkerToolConfig,
): Promise<ToolSet | undefined> {
  if (toolIds.length === 0 && !outputTool) return undefined;

  const tools: ToolSet = {};
  const idSet = new Set(toolIds);
  const hasBrokerWiring = Boolean(ctx.brokerRouting && ctx.brokerRegistry);

  if (outputTool) {
    tools[outputTool.name] = tool({
      description: outputTool.description,
      inputSchema: outputTool.schema,
      execute: async (input: unknown) => input,
    });
  }

  if (idSet.has("search_web")) {
    if (ctx.isMockSession && ctx.mockWebSearchData) {
      tools.search_web = createMockSearchTool({
        sessionId: ctx.sessionId,
        apiCallLogRepo: ctx.apiCallLogRepo,
        cycleId: ctx.cycleId,
        tradeId: ctx.tradeId ?? null,
        mockWebSearchData: ctx.mockWebSearchData,
        mockPrimarySymbols: ctx.mockPrimarySymbols,
      });
    } else {
      if (!ctx.searchProviderId) {
        throw new AppError(
          "Session cannot enable web search because no search provider is configured.",
          "SEARCH_PROVIDER_REQUIRED",
        );
      }
      tools.search_web = await createSearchTool({
        sessionId: ctx.sessionId,
        searchProviderId: ctx.searchProviderId,
        fallbackProviderId: toolConfig?.search_web?.fallbackProviderId ?? null,
        searchRegistry: ctx.searchRegistry,
        apiCallLogRepo: ctx.apiCallLogRepo,
        cycleId: ctx.cycleId,
        tradeId: ctx.tradeId ?? null,
        maxDataSpendUsd: ctx.maxDataSpendUsd,
      });
    }
  }

  if (idSet.has("fetch_url")) {
    tools.fetch_url = createFetchUrlTool({
      sessionId: ctx.sessionId,
      apiCallLogRepo: ctx.apiCallLogRepo,
      cycleId: ctx.cycleId,
      tradeId: ctx.tradeId ?? null,
      maxDataSpendUsd: ctx.maxDataSpendUsd,
      isMockSession: ctx.isMockSession,
      mockUrlContent: ctx.mockUrlContent,
      mockPrimarySymbols: ctx.mockPrimarySymbols,
    });
  }

  if (idSet.has("search_reddit")) {
    tools.search_reddit = createSearchRedditTool({
      sessionId: ctx.sessionId,
      apiCallLogRepo: ctx.apiCallLogRepo,
      cycleId: ctx.cycleId,
      instrumentClasses: ctx.instrumentClasses,
      mockPosts: ctx.mockRedditData,
      isMockSession: ctx.isMockSession,
    });
  }

  if (idSet.has("get_trending_symbols")) {
    tools.get_trending_symbols = createTrendingSymbolsTool({
      sessionId: ctx.sessionId,
      apiCallLogRepo: ctx.apiCallLogRepo,
      cycleId: ctx.cycleId,
      mockSymbols: ctx.mockTrendingData,
    });
  }

  const needsMarket =
    idSet.has("get_quote") || idSet.has("get_ohlcv") || idSet.has("get_news");
  if (
    needsMarket &&
    hasBrokerWiring &&
    ctx.brokerRouting &&
    ctx.brokerRegistry
  ) {
    const searchOk = Boolean(ctx.searchProviderId);
    const marketTools = createMarketTools({
      sessionId: ctx.sessionId,
      brokerRegistry: ctx.brokerRegistry,
      brokerAccountIdByClass: (instrumentClass: InstrumentClass) => {
        try {
          return (
            ctx.brokerRouting?.resolveBrokerAccountId(
              ctx.sessionId,
              instrumentClass,
            ) ?? null
          );
        } catch {
          return null;
        }
      },
      searchRegistry: idSet.has("get_news") ? ctx.searchRegistry : undefined,
      searchProviderId:
        idSet.has("get_news") && searchOk ? ctx.searchProviderId : null,
      include: {
        quote: idSet.has("get_quote"),
        ohlcv: idSet.has("get_ohlcv"),
        news: idSet.has("get_news"),
      },
      getMockOhlcv: ctx.getMockOhlcv,
      mockNewsData: ctx.mockNewsData,
    });
    if (marketTools.get_quote) tools.get_quote = marketTools.get_quote;
    if (marketTools.get_ohlcv) tools.get_ohlcv = marketTools.get_ohlcv;
    if (marketTools.get_news) tools.get_news = marketTools.get_news;
  }

  return Object.keys(tools).length > 0 ? tools : undefined;
}
