import { tool, type ToolSet } from "ai";
import { z } from "zod";
import type { InstrumentClass } from "@/lib/types";
import type { BrokerRegistry } from "../../broker/broker-registry";
import type { MockScenarioBias } from "../../broker/adapters/mock-adapter";
import type { SearchRegistry } from "../search";
import { sanitizeSearchQuery } from "../search/sanitize-search-query";

const instrumentClassSchema = z.enum(["stock", "crypto", "futures", "prediction_market"]);
const DAY_MS = 24 * 60 * 60 * 1000;

type SyntheticBar = {
  ts: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
};

export interface MockNewsItem {
  title: string;
  snippet: string;
  url: string;
  publishedAt: string;
}

const NEUTRAL_MOCK_NEWS: MockNewsItem[] = [
  {
    title: "Markets steady as macro data comes in mixed",
    snippet: "Equities remain range-bound with no clear directional catalyst after this week's data releases.",
    url: "https://mock.local/news/1",
    publishedAt: new Date().toISOString(),
  },
  {
    title: "No significant corporate news for this instrument this week",
    snippet: "Volume has been below average. No earnings, no filings, no analyst upgrades or downgrades.",
    url: "https://mock.local/news/2",
    publishedAt: new Date().toISOString(),
  },
  {
    title: "Sector rotation continues as investors reassess positioning",
    snippet: "Broad sector moves reflect ongoing macro uncertainty. Individual stock fundamentals remain the primary driver.",
    url: "https://mock.local/news/3",
    publishedAt: new Date().toISOString(),
  },
];

export const MOCK_NEWS_BY_SCENARIO: Record<MockScenarioBias, MockNewsItem[]> = {
  bullish: [
    {
      title: "{symbol} shows continued breakout momentum on rising volume",
      snippet: "{symbol} is pressing into fresh short-term highs with above-average volume and follow-through buying interest.",
      url: "https://mock.local/news/bullish-1",
      publishedAt: new Date().toISOString(),
    },
    {
      title: "Institutional accumulation builds in {symbol}",
      snippet: "Buyers continue to support {symbol} after a strong multi-session move, with traders watching for continuation entries.",
      url: "https://mock.local/news/bullish-2",
      publishedAt: new Date().toISOString(),
    },
    {
      title: "Momentum traders eye {symbol} after catalyst-driven strength",
      snippet: "Recent strength in {symbol} is being reinforced by bullish sentiment, expanding participation, and favorable breakout structure.",
      url: "https://mock.local/news/bullish-3",
      publishedAt: new Date().toISOString(),
    },
  ],
  bearish: [
    {
      title: "{symbol} slips as sellers press recent support",
      snippet: "Selling pressure in {symbol} is building as failed bounces and weak tape point to distribution.",
      url: "https://mock.local/news/bearish-1",
      publishedAt: new Date().toISOString(),
    },
    {
      title: "Risk-off flow weighs on {symbol}",
      snippet: "Participants are cutting exposure in {symbol} as momentum fades and downside follow-through increases.",
      url: "https://mock.local/news/bearish-2",
      publishedAt: new Date().toISOString(),
    },
    {
      title: "Failed breakout leaves {symbol} vulnerable",
      snippet: "A rejected move higher in {symbol} has traders watching for continuation lower if support breaks.",
      url: "https://mock.local/news/bearish-3",
      publishedAt: new Date().toISOString(),
    },
  ],
  sideways: NEUTRAL_MOCK_NEWS,
  volatile: [
    {
      title: "{symbol} whipsaws as volatility expands",
      snippet: "Large intraday swings in {symbol} are creating short-term trading opportunities without a stable directional trend.",
      url: "https://mock.local/news/volatile-1",
      publishedAt: new Date().toISOString(),
    },
    {
      title: "Fast reversals keep {symbol} range traders active",
      snippet: "{symbol} is bouncing sharply between support and resistance as traders react to unstable risk sentiment.",
      url: "https://mock.local/news/volatile-2",
      publishedAt: new Date().toISOString(),
    },
    {
      title: "{symbol} sees elevated volume in choppy tape",
      snippet: "Volatility remains high in {symbol}, favoring quick reaction trades over clean trend continuation.",
      url: "https://mock.local/news/volatile-3",
      publishedAt: new Date().toISOString(),
    },
  ],
};

export function scenarioMockNews(bias: MockScenarioBias = "bullish"): MockNewsItem[] {
  return MOCK_NEWS_BY_SCENARIO[bias].map((item) => ({ ...item }));
}

export const DEFAULT_MOCK_NEWS: MockNewsItem[] = scenarioMockNews("bullish");

export type MarketToolsInclude = {
  quote: boolean;
  ohlcv: boolean;
  news: boolean;
};

export function createMarketTools(deps: {
  sessionId: string;
  brokerRegistry: BrokerRegistry;
  brokerAccountIdByClass: (instrumentClass: InstrumentClass) => string | null;
  searchRegistry?: SearchRegistry;
  searchProviderId?: string | null;
  include: MarketToolsInclude;
  getMockOhlcv?: (symbol: string, timeframe?: string) => SyntheticBar[];
  mockNewsData?: MockNewsItem[];
}) {
  const out: Partial<ToolSet> = {};

  if (deps.include.quote) {
    out.get_quote = tool({
      description: "Get current price and basic quote data for a symbol.",
      inputSchema: z.object({ symbol: z.string(), instrumentClass: instrumentClassSchema }),
      execute: async ({ symbol, instrumentClass }: { symbol: string; instrumentClass: InstrumentClass }) => {
        const brokerAccountId = deps.brokerAccountIdByClass(instrumentClass);
        if (!brokerAccountId) return { error: "No broker account routing available for this instrument class." };
        try {
          const adapter = await deps.brokerRegistry.get(brokerAccountId);
          return await adapter.getMarketSnapshot(symbol);
        } catch (error) {
          return toToolError(error);
        }
      },
    });
  }

  if (deps.include.ohlcv) {
    out.get_ohlcv = tool({
      description: "Get OHLCV bars for a symbol. Supports timeframes: 1h, 4h, 1d (default). Returns up to 200 bars.",
      inputSchema: z.object({
        symbol: z.string(),
        instrumentClass: instrumentClassSchema,
        timeframe: z.enum(["1h", "4h", "1d"]).default("1d").optional(),
      }),
      execute: async ({
        symbol,
        instrumentClass,
        timeframe = "1d",
      }: {
        symbol: string;
        instrumentClass: InstrumentClass;
        timeframe?: string;
      }) => {
        if (deps.getMockOhlcv) {
          return { symbol, timeframe, bars: deps.getMockOhlcv(symbol, timeframe) };
        }
        const brokerAccountId = deps.brokerAccountIdByClass(instrumentClass);
        if (!brokerAccountId) return { error: "No broker account routing available for this instrument class." };
        try {
          const adapter = await deps.brokerRegistry.get(brokerAccountId);
          const snap = await adapter.getMarketSnapshot(symbol);
          return {
            symbol,
            timeframe,
            bars: buildSyntheticBars(snap.price),
            note: "Synthetic OHLCV generated from latest market snapshot.",
          };
        } catch (error) {
          return toToolError(error);
        }
      },
    });
  }

  if (deps.include.news) {
    out.get_news = tool({
      description: "Get recent news headlines for a symbol.",
      inputSchema: z.object({ symbol: z.string() }),
      execute: async ({ symbol }: { symbol: string }) => {
        if (deps.mockNewsData) {
          const symbolToken = symbol.toUpperCase();
          return {
            results: deps.mockNewsData.map((n) => ({
              ...n,
              title: n.title.replaceAll("{symbol}", symbolToken),
              snippet: n.snippet.replaceAll("{symbol}", symbolToken),
              query: symbol,
            })),
          };
        }
        if (!deps.searchRegistry || !deps.searchProviderId) {
          return { error: "Search provider not configured for news tool." };
        }
        try {
          const adapter = await deps.searchRegistry.get(deps.searchProviderId);
          return adapter.search(sanitizeSearchQuery(`${symbol} latest market news`));
        } catch (error) {
          return toToolError(error);
        }
      },
    });
  }

  return out;
}

function buildSyntheticBars(spot: number): SyntheticBar[] {
  const bars: SyntheticBar[] = [];
  const now = Date.now();
  for (let i = 29; i >= 0; i--) {
    const ts = new Date(now - i * DAY_MS).toISOString();
    // progress goes from 0 (oldest bar, i=29) to 1 (newest bar, i=0)
    const progress = (29 - i) / 29;
    const close = round2(Math.max(0.01, spot * (0.955 + progress * 0.045)));
    const open = round2(close * (1 - 0.002 + Math.random() * 0.004));
    const high = round2(Math.max(open, close) * 1.004);
    const low = round2(Math.min(open, close) * 0.996);
    bars.push({
      ts,
      open,
      high,
      low,
      close,
      volume: null,
    });
  }
  return bars;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function toToolError(error: unknown): { error: string } {
  return { error: error instanceof Error ? error.message : String(error) };
}
