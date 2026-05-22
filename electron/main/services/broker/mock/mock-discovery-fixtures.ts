import type { MockScenarioKind } from "@electron/shared/domain/mock-scenario";

export type MockWebSearchItem = {
  title: string;
  snippet: string;
  url: string;
  publishedDate: string | null;
};

const nowIso = () => new Date().toISOString();

function searchItem(
  title: string,
  snippet: string,
  path: string,
): MockWebSearchItem {
  return {
    title,
    snippet,
    url: `https://mock.local/${path}`,
    publishedDate: nowIso(),
  };
}

function pageBody(paragraphs: string[]): string {
  return paragraphs.join("\n\n");
}

export const SCENARIO_PRIMARY_SYMBOLS: Record<MockScenarioKind, string[]> = {
  clean_breakout: ["NVDA", "AMD", "PLTR"],
  failed_breakout: ["AAPL", "META", "NFLX"],
  sideways_chop: ["SPY", "QQQ", "IWM"],
  gap_down_after_entry: ["AAPL", "AMZN", "GOOGL"],
  news_reversal: ["TSLA", "META", "AMZN"],
  stale_quote: ["RIVN", "LCID", "SOFI"],
  wide_spread: ["RIVN", "BBAI", "OPEN"],
  partial_fill: ["GME", "MSTR", "HOOD"],
  broker_reject: ["NVDA", "AMD", "AVGO"],
  rate_limit: ["NVDA", "PLTR", "TSLA"],
};

const BULLISH_SEARCH: MockWebSearchItem[] = [
  searchItem(
    "{symbol} breaks out above resistance on strong volume",
    "{symbol} cleared prior resistance with above-average volume and follow-through buying; momentum traders cite clean continuation structure.",
    "search/clean_breakout/1",
  ),
  searchItem(
    "Momentum scan flags {symbol} as trend leader",
    "Screeners highlight {symbol} for persistent relative strength, higher highs, and expanding participation after a catalyst-driven move.",
    "search/clean_breakout/2",
  ),
  searchItem(
    "{symbol} swing setup: breakout entry with trailing risk",
    "Technical write-up on {symbol} notes a textbook breakout hold above the breakout level with volume confirming the move.",
    "search/clean_breakout/3",
  ),
];

const BEARISH_SEARCH: MockWebSearchItem[] = [
  searchItem(
    "{symbol} fails at resistance as sellers regain control",
    "A breakout attempt in {symbol} rejected at prior highs; distribution and weak follow-through suggest downside risk.",
    "search/failed_breakout/1",
  ),
  searchItem(
    "Traders fade {symbol} after failed push higher",
    "Momentum faded in {symbol} as the move above resistance could not hold; stops triggered below the breakout level.",
    "search/failed_breakout/2",
  ),
];

const NEUTRAL_SEARCH: MockWebSearchItem[] = [
  searchItem(
    "{symbol} stuck in a tight range with no catalyst",
    "Price action in {symbol} remains range-bound with below-average volume and no clear directional edge for swing traders.",
    "search/sideways/1",
  ),
];

export const SCENARIO_WEB_SEARCH: Record<MockScenarioKind, MockWebSearchItem[]> =
  {
    clean_breakout: BULLISH_SEARCH,
    failed_breakout: BEARISH_SEARCH,
    sideways_chop: NEUTRAL_SEARCH,
    gap_down_after_entry: [
      searchItem(
        "{symbol} gaps down after earnings miss and guidance cut",
        "Shares of {symbol} fell sharply pre-market after missing estimates and reducing full-year outlook.",
        "search/gap_down/1",
      ),
    ],
    news_reversal: [
      searchItem(
        "{symbol} CEO resigns; guidance slashed despite bullish chart",
        "Fundamental deterioration in {symbol} contradicts recent technical strength; analysts downgrade outlook.",
        "search/news_reversal/1",
      ),
      ...BULLISH_SEARCH.slice(0, 1),
    ],
    stale_quote: NEUTRAL_SEARCH,
    wide_spread: NEUTRAL_SEARCH,
    partial_fill: BULLISH_SEARCH.slice(0, 2),
    broker_reject: BULLISH_SEARCH.slice(0, 2),
    rate_limit: BULLISH_SEARCH.slice(0, 2),
  };

function urlPages(
  entries: Array<[string, string[]]>,
): Record<string, string> {
  return Object.fromEntries(
    entries.map(([path, paragraphs]) => [
      `https://mock.local/${path}`,
      pageBody(paragraphs),
    ]),
  );
}

export const SCENARIO_URL_CONTENT: Record<
  MockScenarioKind,
  Record<string, string>
> = {
  clean_breakout: urlPages([
    [
      "search/clean_breakout/1",
      [
        "{symbol} Breakout Analysis",
        "{symbol} has broken above a well-defined resistance zone on volume roughly 40% above the 20-day average.",
        "The sequence of higher lows remains intact and the most recent session closed near the high of the range, favoring continuation entries on pullbacks.",
      ],
    ],
    [
      "search/clean_breakout/2",
      [
        "Trend Scan: {symbol}",
        "Relative strength ranks in the top decile over the last month. Momentum oscillators remain constructive without extreme overbought readings.",
        "Traders are watching a measured move target above current prices if the breakout level holds as support.",
      ],
    ],
    [
      "search/clean_breakout/3",
      [
        "Swing Setup — {symbol}",
        "Entry framework: buy strength above the breakout pivot with a stop below the last higher low.",
        "Risk/reward remains favorable for a multi-day swing while volume confirms institutional participation.",
      ],
    ],
  ]),
  failed_breakout: urlPages([
    [
      "search/failed_breakout/1",
      [
        "{symbol} Rejection at Resistance",
        "Price tagged prior highs but reversed sharply on heavy volume, leaving a failed breakout pattern.",
        "Support below is vulnerable if sellers continue to press the tape.",
      ],
    ],
  ]),
  sideways_chop: urlPages([
    [
      "search/sideways/1",
      [
        "{symbol} Range Notes",
        "No durable trend is present. Best action is to wait for a resolution outside the current range.",
      ],
    ],
  ]),
  gap_down_after_entry: urlPages([
    [
      "search/gap_down/1",
      [
        "{symbol} Earnings Shock",
        "Reported EPS missed consensus and management cut guidance materially. Gap risk dominates the setup.",
      ],
    ],
  ]),
  news_reversal: urlPages([
    [
      "search/news_reversal/1",
      [
        "{symbol} Fundamental Red Flags",
        "Despite recent chart strength, leadership change and a major guidance cut create asymmetric downside risk.",
      ],
    ],
    [
      "search/clean_breakout/1",
      [
        "{symbol} Technical Snapshot",
        "Chart structure had been constructive, but fresh fundamental headlines override the prior bullish bias near term.",
      ],
    ],
  ]),
  stale_quote: {},
  wide_spread: {},
  partial_fill: urlPages([
    [
      "search/clean_breakout/1",
      [
        "{symbol} Thin Liquidity",
        "Demand is present but available size at the ask is limited; partial fills are likely.",
      ],
    ],
  ]),
  broker_reject: urlPages([
    [
      "search/clean_breakout/1",
      [
        "{symbol} Momentum Intact",
        "Tape remains constructive even if broker routing may impose limits unrelated to setup quality.",
      ],
    ],
  ]),
  rate_limit: urlPages([
    [
      "search/clean_breakout/1",
      [
        "{symbol} Setup Watch",
        "Breakout structure remains valid; execution infrastructure may throttle order flow temporarily.",
      ],
    ],
  ]),
};

export function substituteMockSymbol(text: string, symbol: string): string {
  return text.replaceAll("{symbol}", symbol.toUpperCase());
}

const SYMBOL_NOISE = new Set([
  "I",
  "A",
  "S",
  "US",
  "UK",
  "EU",
  "AI",
  "IT",
  "OR",
  "AT",
  "ON",
  "IF",
  "TV",
  "CEO",
  "IPO",
  "ETF",
]);

export function extractQuerySymbol(
  query: string,
  knownSymbols?: string[],
): string | null {
  const upper = query.toUpperCase();
  if (knownSymbols?.length) {
    for (const sym of knownSymbols) {
      if (new RegExp(`\\b${sym}\\b`).test(upper)) return sym;
    }
  }
  const matches = upper.match(/\b[A-Z]{1,5}\b/g) ?? [];
  for (const token of matches) {
    if (token.length >= 2 && !SYMBOL_NOISE.has(token)) return token;
  }
  return null;
}

export function resolveMockSymbolForUrl(
  url: string,
  primarySymbols?: string[],
): string {
  const upper = url.toUpperCase();
  if (primarySymbols?.length) {
    for (const sym of primarySymbols) {
      if (new RegExp(`\\b${sym}\\b`).test(upper)) return sym;
    }
    return primarySymbols[0]!;
  }
  return "TICKER";
}

export function filterMockWebSearch(
  items: MockWebSearchItem[],
  query: string,
  limit = 8,
  knownSymbols?: string[],
): MockWebSearchItem[] {
  const symbol = extractQuerySymbol(query.toUpperCase(), knownSymbols);
  const tokens = query
    .toLowerCase()
    .split(/\W+/)
    .filter((token) => token.length > 2);

  const scored = items.map((item) => {
    const hay = `${item.title} ${item.snippet}`.toLowerCase();
    const tokenScore = tokens.reduce(
      (sum, token) => sum + (hay.includes(token) ? 1 : 0),
      0,
    );
    return { item, score: tokenScore };
  });

  const filtered =
    tokens.length === 0 ? scored : scored.filter((entry) => entry.score > 0);

  const ranked = (filtered.length > 0 ? filtered : scored)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.item);

  return ranked.map((item) => ({
    ...item,
    title: substituteMockSymbol(item.title, symbol ?? "TICKER"),
    snippet: substituteMockSymbol(item.snippet, symbol ?? "TICKER"),
  }));
}
