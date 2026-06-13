import type { BrokerRoutingService } from "../../broker/broker-routing-service";
import type { BrokerRegistry } from "../../broker/broker-registry";
import { MockBrokerAdapter } from "../../broker/adapters/mock-adapter";
import type { MockOhlcvBar } from "../../broker/adapters/mock-adapter";
import { MockMarketSimulator } from "../../broker/mock/mock-market-simulator";
import {
  substituteMockSymbol,
  type MockWebSearchItem,
} from "../../broker/mock/mock-discovery-fixtures";
import {
  DEFAULT_MOCK_EXECUTION_TIER,
  DEFAULT_MOCK_SCENARIO_KIND,
  type MockExecutionTier,
  type MockScenarioKind,
} from "@electron/shared/domain/mock-scenario";
import {
  scriptedWorkerOutputsForScenario,
  type ScriptedWorkerOutputs,
} from "../../broker/mock/mock-scenario-worker-outputs";
import { MOCK_TRENDING_SYMBOLS } from "../../tools/trending-symbols-tool";
import type { InstrumentClass } from "@/lib/types";

export type MockToolContext = {
  isMockSession: boolean;
  mockScenarioKind?: MockScenarioKind;
  executionTier?: MockExecutionTier;
  scriptedWorkerOutputs?: ScriptedWorkerOutputs;
  getMockOhlcv?: (symbol: string, timeframe?: string) => MockOhlcvBar[];
  mockTrendingData?: typeof MOCK_TRENDING_SYMBOLS;
  mockWebSearchData?: MockWebSearchItem[];
  mockUrlContent?: Record<string, string>;
  mockPrimarySymbols?: string[];
};

export async function resolveMockToolContext(input: {
  sessionId: string;
  focusInstrumentClass?: InstrumentClass | null;
  brokerRouting?: BrokerRoutingService;
  brokerRegistry?: BrokerRegistry;
}): Promise<MockToolContext> {
  const mockAdapter = await resolveMockAdapter(input);
  if (!mockAdapter) {
    return {
      isMockSession: false,
      mockScenarioKind: undefined,
      getMockOhlcv: undefined,
      mockTrendingData: undefined,
      mockWebSearchData: undefined,
      mockUrlContent: undefined,
      mockPrimarySymbols: undefined,
    };
  }

  const kind = mockAdapter.getScenarioKind() ?? DEFAULT_MOCK_SCENARIO_KIND;
  const executionTier =
    mockAdapter.getExecutionTier() ?? DEFAULT_MOCK_EXECUTION_TIER;
  const fixtures = MockMarketSimulator.fixturesFor(kind);
  const focusedFixtures = applyMockInstrumentFocus(
    fixtures,
    input.focusInstrumentClass,
  );
  const primarySymbol = focusedFixtures.primarySymbols?.[0];
  const scriptedWorkerOutputs =
    executionTier === "scripted"
      ? scriptedWorkerOutputsForScenario(kind, primarySymbol)
      : undefined;

  return {
    isMockSession: true,
    mockScenarioKind: kind,
    executionTier,
    scriptedWorkerOutputs,
    getMockOhlcv: (symbol: string, timeframe?: string) =>
      mockAdapter.getMockOhlcv(symbol, timeframe),
    mockTrendingData: (focusedFixtures.trendingSymbols ??
      MOCK_TRENDING_SYMBOLS) as typeof MOCK_TRENDING_SYMBOLS,
    mockWebSearchData: focusedFixtures.webSearch,
    mockUrlContent: fixtures.urlContent,
    mockPrimarySymbols: focusedFixtures.primarySymbols,
  };
}

const FOCUSED_PRIMARY_SYMBOLS: Record<InstrumentClass, string[]> = {
  stock: ["NVDA", "AMD", "PLTR"],
  crypto: ["BTC-USD", "ETH-USD", "SOL-USD"],
  futures: ["ES", "NQ", "CL"],
  prediction_market: ["BTC100", "ETHETF", "FEDCUT"],
};

const FOCUSED_SYMBOL_NAMES: Record<string, string> = {
  NVDA: "NVIDIA Corp",
  AMD: "Advanced Micro Devices",
  PLTR: "Palantir Technologies",
  "BTC-USD": "Bitcoin",
  "ETH-USD": "Ethereum",
  "SOL-USD": "Solana",
  ES: "E-mini S&P 500",
  NQ: "E-mini Nasdaq 100",
  CL: "Crude Oil Futures",
  BTC100: "Bitcoin above $100k",
  ETHETF: "Spot ETH ETF approval",
  FEDCUT: "Fed rate cut by next meeting",
};

function applyMockInstrumentFocus(
  fixtures: {
    trendingSymbols?: Array<{
      symbol: string;
      name: string;
      messageVolume: number;
      sentiment: string;
      watchlistCount: number;
    }>;
    webSearch?: MockWebSearchItem[];
    primarySymbols?: string[];
    urlContent?: Record<string, string>;
  },
  focusInstrumentClass?: InstrumentClass | null,
) {
  if (!focusInstrumentClass) return fixtures;

  const primarySymbols = FOCUSED_PRIMARY_SYMBOLS[focusInstrumentClass];
  return {
    ...fixtures,
    primarySymbols,
    trendingSymbols: primarySymbols.map((symbol, index) => ({
      symbol,
      name: FOCUSED_SYMBOL_NAMES[symbol] ?? symbol,
      messageVolume: 1400 - index * 230,
      sentiment: index === 2 ? "Neutral" : "Bullish",
      watchlistCount: 900000 - index * 170000,
    })),
    webSearch:
      fixtures.webSearch?.map((item, index) => {
        const symbol =
          primarySymbols[index % primarySymbols.length] ??
          symbolForIndex(index);
        return {
          ...item,
          title: substituteMockSymbol(item.title, symbol),
          snippet: substituteMockSymbol(item.snippet, symbol),
        };
      }) ?? fixtures.webSearch,
  };
}

function symbolForIndex(index: number): string {
  return (
    FOCUSED_PRIMARY_SYMBOLS.stock[
      index % FOCUSED_PRIMARY_SYMBOLS.stock.length
    ] ?? "NVDA"
  );
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
      if (adapter.brokerType === "mock")
        return adapter as unknown as MockBrokerAdapter;
    } catch {
      // try next class
    }
  }

  return null;
}
