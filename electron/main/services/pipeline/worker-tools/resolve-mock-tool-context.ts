import type { BrokerRoutingService } from "../../broker/broker-routing-service";
import type { BrokerRegistry } from "../../broker/broker-registry";
import { MockBrokerAdapter } from "../../broker/adapters/mock-adapter";
import type { MockOhlcvBar } from "../../broker/adapters/mock-adapter";
import { MockMarketSimulator } from "../../broker/mock/mock-market-simulator";
import type { MockWebSearchItem } from "../../broker/mock/mock-discovery-fixtures";
import {
  DEFAULT_MOCK_SCENARIO_KIND,
  type MockScenarioKind,
} from "@electron/shared/domain/mock-scenario";
import { scenarioMockNews, type MockNewsItem } from "../../tools/market-tools";
import { MOCK_REDDIT_POSTS } from "../../tools/search-reddit-tool";
import { MOCK_TRENDING_SYMBOLS } from "../../tools/trending-symbols-tool";

export type MockToolContext = {
  isMockSession: boolean;
  mockScenarioKind?: MockScenarioKind;
  getMockOhlcv?: (symbol: string, timeframe?: string) => MockOhlcvBar[];
  mockNewsData?: MockNewsItem[];
  mockRedditData?: typeof MOCK_REDDIT_POSTS;
  mockTrendingData?: typeof MOCK_TRENDING_SYMBOLS;
  mockWebSearchData?: MockWebSearchItem[];
  mockUrlContent?: Record<string, string>;
  mockPrimarySymbols?: string[];
};

export async function resolveMockToolContext(input: {
  sessionId: string;
  brokerRouting?: BrokerRoutingService;
  brokerRegistry?: BrokerRegistry;
}): Promise<MockToolContext> {
  const mockAdapter = await resolveMockAdapter(input);
  if (!mockAdapter) {
    return {
      isMockSession: false,
      mockScenarioKind: undefined,
      getMockOhlcv: undefined,
      mockNewsData: undefined,
      mockRedditData: undefined,
      mockTrendingData: undefined,
      mockWebSearchData: undefined,
      mockUrlContent: undefined,
      mockPrimarySymbols: undefined,
    };
  }

  const kind = mockAdapter.getScenarioKind() ?? DEFAULT_MOCK_SCENARIO_KIND;
  const fixtures = MockMarketSimulator.fixturesFor(kind);
  return {
    isMockSession: true,
    mockScenarioKind: kind,
    getMockOhlcv: (symbol: string, timeframe?: string) =>
      mockAdapter.getMockOhlcv(symbol, timeframe),
    mockNewsData:
      fixtures.news ?? scenarioMockNews(mockAdapter.getScenarioBias()),
    mockRedditData: (fixtures.redditPosts ??
      MOCK_REDDIT_POSTS) as typeof MOCK_REDDIT_POSTS,
    mockTrendingData: (fixtures.trendingSymbols ??
      MOCK_TRENDING_SYMBOLS) as typeof MOCK_TRENDING_SYMBOLS,
    mockWebSearchData: fixtures.webSearch,
    mockUrlContent: fixtures.urlContent,
    mockPrimarySymbols: fixtures.primarySymbols,
  };
}

async function resolveMockAdapter(input: {
  sessionId: string;
  brokerRouting?: BrokerRoutingService;
  brokerRegistry?: BrokerRegistry;
}): Promise<MockBrokerAdapter | null> {
  if (!input.brokerRouting || !input.brokerRegistry) return null;

  for (const instrumentClass of [
    "stock",
    "crypto",
    "futures",
    "prediction_market",
  ] as const) {
    try {
      const accountId = input.brokerRouting.resolveBrokerAccountId(
        input.sessionId,
        instrumentClass,
      );
      const adapter = await input.brokerRegistry.get(accountId);
      if (adapter.brokerType === "mock") return adapter as MockBrokerAdapter;
    } catch {
      // try next class
    }
  }

  return null;
}
