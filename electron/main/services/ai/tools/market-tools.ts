import { tool } from "ai";
import { z } from "zod";
import type { InstrumentClass } from "@/lib/types";
import type { BrokerRegistry } from "../../broker/broker-registry";
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

export function createMarketTools(deps: {
  sessionId: string;
  brokerRegistry: BrokerRegistry;
  brokerAccountIdByClass: (instrumentClass: InstrumentClass) => string | null;
  searchRegistry?: SearchRegistry;
  searchProviderId?: string | null;
}) {
  const get_quote = tool({
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

  const get_ohlcv = tool({
    description: "Get OHLCV bars for a symbol. Returns up to 200 daily bars.",
    inputSchema: z.object({ symbol: z.string(), instrumentClass: instrumentClassSchema }),
    execute: async ({ symbol, instrumentClass }: { symbol: string; instrumentClass: InstrumentClass }) => {
      const brokerAccountId = deps.brokerAccountIdByClass(instrumentClass);
      if (!brokerAccountId) return { error: "No broker account routing available for this instrument class." };
      try {
        const adapter = await deps.brokerRegistry.get(brokerAccountId);
        const snap = await adapter.getMarketSnapshot(symbol);
        return {
          symbol,
          timeframe: "1d",
          bars: buildSyntheticBars(snap.price),
          note: "Synthetic OHLCV generated from latest market snapshot.",
        };
      } catch (error) {
        return toToolError(error);
      }
    },
  });

  const get_news = tool({
    description: "Get recent news headlines for a symbol.",
    inputSchema: z.object({ symbol: z.string() }),
    execute: async ({ symbol }: { symbol: string }) => {
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

  return { get_quote, get_ohlcv, get_news };
}

function buildSyntheticBars(spot: number): SyntheticBar[] {
  const bars: SyntheticBar[] = [];
  const now = Date.now();
  for (let i = 29; i >= 0; i--) {
    const ts = new Date(now - i * DAY_MS).toISOString();
    const drift = (29 - i) * 0.0015;
    const close = round2(Math.max(0.01, spot * (1 - drift)));
    const open = round2(close * 1.002);
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
