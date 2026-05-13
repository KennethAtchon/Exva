import { tool, type ToolSet } from "ai";
import type { AgentRole, InstrumentClass } from "@/lib/types";
import { instrumentSelectionToolInputSchema, type InstrumentSelection } from "@/lib/schemas";
import type { ApiCallLogRepo } from "../../../db/repositories/api-call-log-repo";
import type { SearchRegistry } from "../search";
import { createMarketTools, type MockNewsItem } from "../tools/market-tools";
import { createFetchUrlTool } from "../tools/fetch-url-tool";
import { createSearchRedditTool, MOCK_REDDIT_POSTS } from "../tools/search-reddit-tool";
import { createTrendingSymbolsTool, MOCK_TRENDING_SYMBOLS } from "../tools/trending-symbols-tool";
import type { BrokerRoutingService } from "../../broker/broker-routing-service";
import type { BrokerRegistry } from "../../broker/broker-registry";
import type { RoleToolPolicy } from "./ai-runtime-types";
import { ROLE_TOOL_POLICY } from "./ai-runtime-types";
import type { MockOhlcvBar } from "../../broker/adapters/mock-adapter";

/** Tools actually registered for this run (policy ∩ infra). Drives prompts and ToolSet construction. */
export type HarnessToolAvailability = {
  searchWeb: boolean;
  fetchUrl: boolean;
  searchReddit: boolean;
  trendingSymbols: boolean;
  getNews: boolean;
  getQuote: boolean;
  getOhlcv: boolean;
  submitCandidates: boolean;
};

export function deriveHarnessToolAvailability(
  policy: RoleToolPolicy,
  searchProviderId: string | null,
  hasBrokerWiring: boolean,
  hasMockNewsData = false,
): HarnessToolAvailability {
  if (policy.enforceNoTools) {
    return {
      searchWeb: false,
      fetchUrl: false,
      searchReddit: false,
      trendingSymbols: false,
      getNews: false,
      getQuote: false,
      getOhlcv: false,
      submitCandidates: false,
    };
  }
  const searchOk = Boolean(searchProviderId);
  const brokerOk = hasBrokerWiring;
  const newsOk = brokerOk && (searchOk || hasMockNewsData);
  return {
    submitCandidates: policy.allowSubmitCandidates,
    searchWeb: policy.allowSearch && searchOk,
    fetchUrl: policy.allowFetchUrl,
    searchReddit: policy.allowSearchReddit,
    trendingSymbols: policy.allowTrendingSymbols,
    getQuote: policy.allowMarketQuoteTools && brokerOk,
    getOhlcv: policy.allowMarketQuoteTools && brokerOk,
    getNews: policy.allowMarketNewsTool && newsOk,
  };
}

export function harnessToolAvailabilityForRole(
  role: AgentRole,
  searchProviderId: string | null,
  hasBrokerWiring: boolean,
  hasMockNewsData = false,
): HarnessToolAvailability {
  return deriveHarnessToolAvailability(ROLE_TOOL_POLICY[role], searchProviderId, hasBrokerWiring, hasMockNewsData);
}

export async function buildHarnessToolSet(input: {
  sessionId: string;
  role: AgentRole;
  cycleId: string | null;
  availability: HarnessToolAvailability;
  searchProviderId: string | null;
  resolveSearchTool: (sessionId: string, context?: { cycleId?: string | null; tradeId?: string | null }) => Promise<
    ToolSet[keyof ToolSet]
  >;
  searchRegistry: SearchRegistry;
  apiCallLogRepo: ApiCallLogRepo;
  brokerRouting?: BrokerRoutingService;
  brokerRegistry?: BrokerRegistry;
  maxDataSpendUsd?: number | null;
  instrumentClasses?: InstrumentClass[];
  getMockOhlcv?: (symbol: string, timeframe?: string) => MockOhlcvBar[];
  mockNewsData?: MockNewsItem[];
  mockRedditData?: typeof MOCK_REDDIT_POSTS;
  mockTrendingData?: typeof MOCK_TRENDING_SYMBOLS;
  isMockSession?: boolean;
}): Promise<ToolSet | undefined> {
  const { availability } = input;
  const tools: ToolSet = {};

  if (availability.submitCandidates) {
    tools.submit_candidates = tool({
      description: "Submit the final shortlist when research is complete.",
      inputSchema: instrumentSelectionToolInputSchema,
      execute: async (candidates): Promise<InstrumentSelection> => ({
        instruments: candidates.instruments.map((instrument) => ({
          ...instrument,
          symbol: normalizeSymbol(instrument.symbol),
        })),
      }),
    });
  }

  if (availability.searchWeb) {
    tools.search_web = await input.resolveSearchTool(input.sessionId, { cycleId: input.cycleId });
  }

  if (availability.fetchUrl) {
    tools.fetch_url = createFetchUrlTool({
      sessionId: input.sessionId,
      apiCallLogRepo: input.apiCallLogRepo,
      cycleId: input.cycleId,
      maxDataSpendUsd: input.maxDataSpendUsd,
    });
  }

  if (availability.searchReddit) {
    tools.search_reddit = createSearchRedditTool({
      sessionId: input.sessionId,
      apiCallLogRepo: input.apiCallLogRepo,
      cycleId: input.cycleId,
      instrumentClasses: input.instrumentClasses,
      mockPosts: input.mockRedditData,
      isMockSession: input.isMockSession,
    });
  }

  if (availability.trendingSymbols) {
    tools.get_trending_symbols = createTrendingSymbolsTool({
      sessionId: input.sessionId,
      apiCallLogRepo: input.apiCallLogRepo,
      cycleId: input.cycleId,
      mockSymbols: input.mockTrendingData,
    });
  }

  const needMarket =
    availability.getQuote || availability.getOhlcv || availability.getNews;
  if (needMarket) {
    if (!input.brokerRouting || !input.brokerRegistry) {
      return Object.keys(tools).length > 0 ? tools : undefined;
    }
    const marketTools = createMarketTools({
      sessionId: input.sessionId,
      brokerRegistry: input.brokerRegistry,
      brokerAccountIdByClass: (instrumentClass: InstrumentClass) => {
        try {
          return input.brokerRouting?.resolveBrokerAccountId(input.sessionId, instrumentClass) ?? null;
        } catch {
          return null;
        }
      },
      searchRegistry: availability.getNews ? input.searchRegistry : undefined,
      searchProviderId: availability.getNews ? input.searchProviderId : null,
      include: {
        quote: availability.getQuote,
        ohlcv: availability.getOhlcv,
        news: availability.getNews,
      },
      getMockOhlcv: input.getMockOhlcv,
      mockNewsData: input.mockNewsData,
    });
    if (marketTools.get_quote) tools.get_quote = marketTools.get_quote;
    if (marketTools.get_ohlcv) tools.get_ohlcv = marketTools.get_ohlcv;
    if (marketTools.get_news) tools.get_news = marketTools.get_news;
  }

  return Object.keys(tools).length > 0 ? tools : undefined;
}

function normalizeSymbol(symbol: string): string {
  const trimmed = symbol.trim();
  return trimmed.startsWith("pm:") ? trimmed : trimmed.toUpperCase();
}
