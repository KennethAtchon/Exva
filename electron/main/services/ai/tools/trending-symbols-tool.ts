import { tool } from "ai";
import { z } from "zod";
import type { ApiCallLogRepo } from "../../../db/repositories/api-call-log-repo";

const STOCKTWITS_URL = "https://api.stocktwits.com/api/2/trending/symbols.json";
const STOCKTWITS_TIMEOUT_MS = 5000;

type StockTwitsSymbol = {
  symbol: string;
  title: string;
  watchlist_count: number;
  messages?: { count?: number };
  sentiment?: { basic?: string };
};

export const MOCK_TRENDING_SYMBOLS = [
  {
    symbol: "NVDA",
    name: "NVIDIA Corp",
    messageVolume: 1432,
    sentiment: "Bullish",
    watchlistCount: 921443,
  },
  {
    symbol: "PLTR",
    name: "Palantir Technologies",
    messageVolume: 911,
    sentiment: "Bullish",
    watchlistCount: 501223,
  },
  {
    symbol: "TSLA",
    name: "Tesla Inc",
    messageVolume: 864,
    sentiment: "Neutral",
    watchlistCount: 1175020,
  },
];

async function fetchTrendingSymbols(): Promise<StockTwitsSymbol[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), STOCKTWITS_TIMEOUT_MS);

  try {
    const response = await fetch(STOCKTWITS_URL, {
      headers: {
        "User-Agent": "Exva/1.0 research-agent",
        Accept: "application/json",
      },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`StockTwits API ${response.status}`);
    const body = (await response.json()) as { symbols?: StockTwitsSymbol[] };
    return body.symbols ?? [];
  } finally {
    clearTimeout(timeout);
  }
}

export function createTrendingSymbolsTool(deps: {
  sessionId: string;
  apiCallLogRepo: ApiCallLogRepo;
  cycleId?: string | null;
  mockSymbols?: typeof MOCK_TRENDING_SYMBOLS;
}) {
  return tool({
    description: [
      "Get the current trending symbols on StockTwits as a real-time retail sentiment signal.",
      "Use this early in discovery to see which symbols active traders are focused on right now.",
      "Returns symbols with message volume, sentiment direction, and watchlist count.",
    ].join(" "),
    inputSchema: z.object({}),
    execute: async () => {
      const startedAt = Date.now();
      const createdAt = new Date().toISOString();

      try {
        const symbols = deps.mockSymbols ?? (await fetchTrendingSymbols()).map((item) => ({
          symbol: item.symbol,
          name: item.title,
          messageVolume: item.messages?.count ?? null,
          sentiment: item.sentiment?.basic ?? null,
          watchlistCount: item.watchlist_count,
        }));

        deps.apiCallLogRepo.insert({
          id: crypto.randomUUID(),
          session_id: deps.sessionId,
          trade_id: null,
          cycle_id: deps.cycleId ?? null,
          provider: "stocktwits",
          endpoint: "/api/2/trending/symbols.json",
          call_type: "search",
          credits_used: 0,
          cost_usd: 0,
          latency_ms: Date.now() - startedAt,
          status: deps.mockSymbols ? "mock" : "ok",
          from_cache: false,
          created_at: createdAt,
        });

        return {
          symbols,
          fetchedAt: createdAt,
          note: "Retail sentiment signal only. Cross-check with market structure and catalysts.",
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        deps.apiCallLogRepo.insert({
          id: crypto.randomUUID(),
          session_id: deps.sessionId,
          trade_id: null,
          cycle_id: deps.cycleId ?? null,
          provider: "stocktwits",
          endpoint: "/api/2/trending/symbols.json",
          call_type: "search",
          credits_used: null,
          cost_usd: 0,
          latency_ms: Date.now() - startedAt,
          status: /abort/i.test(message) ? "timeout" : "error",
          from_cache: false,
          created_at: createdAt,
        });
        return { error: `StockTwits fetch failed: ${message}`, symbols: [] };
      }
    },
  });
}
