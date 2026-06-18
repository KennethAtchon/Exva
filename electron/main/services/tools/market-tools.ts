import { tool, type ToolSet } from "ai";
import { z } from "zod";
import type { InstrumentClass } from "@/lib/types";
import type { BrokerRegistry } from "../broker/broker-registry";
import type { OhlcvBar } from "../broker/adapters/broker-adapter";
import {
  InstrumentNormalizer,
  resolveCanonicalSymbol,
} from "../broker/instrument-normalizer";

const instrumentClassSchema = z.enum([
  "stock",
  "crypto",
  "futures",
  "options",
  "prediction_market",
]);
const instrumentNormalizer = new InstrumentNormalizer();

export type MarketToolsInclude = {
  quote: boolean;
  ohlcv: boolean;
};

export function createMarketTools(deps: {
  sessionId: string;
  brokerRegistry: BrokerRegistry;
  brokerAccountIdByClass: (instrumentClass: InstrumentClass) => string | null;
  include: MarketToolsInclude;
  getMockOhlcv?: (symbol: string, timeframe?: string) => OhlcvBar[];
}) {
  const out: Partial<ToolSet> = {};

  if (deps.include.quote) {
    out.get_quote = tool({
      description: "Get current price and basic quote data for a symbol.",
      inputSchema: z.object({
        symbol: z.string(),
        instrumentClass: instrumentClassSchema,
      }),
      execute: async ({
        symbol,
        instrumentClass,
      }: {
        symbol: string;
        instrumentClass: InstrumentClass;
      }) => {
        const brokerAccountId = deps.brokerAccountIdByClass(instrumentClass);
        if (!brokerAccountId)
          return {
            error:
              "No broker account routing available for this instrument class.",
          };
        try {
          const adapter = await deps.brokerRegistry.get(brokerAccountId);
          const canonicalSymbol = resolveCanonicalSymbol(
            symbol,
            instrumentClass,
          );
          const brokerSymbol = instrumentNormalizer.toBrokerSymbol({
            symbol: canonicalSymbol,
            instrumentClass,
            brokerType: adapter.brokerType,
          });
          const snapshot = await adapter.getMarketSnapshot(brokerSymbol);
          return {
            ...snapshot,
            symbol,
            canonicalSymbol,
            brokerSymbol,
            instrumentClass,
          };
        } catch (error) {
          return toToolError(error);
        }
      },
    });
  }

  if (deps.include.ohlcv) {
    out.get_ohlcv = tool({
      description:
        "Get OHLCV bars for a symbol. Supports timeframes: 1h, 4h, 1d (default). Returns up to 200 bars.",
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
          return {
            symbol,
            timeframe,
            bars: deps.getMockOhlcv(symbol, timeframe),
          };
        }
        const brokerAccountId = deps.brokerAccountIdByClass(instrumentClass);
        if (!brokerAccountId)
          return {
            error:
              "No broker account routing available for this instrument class.",
          };
        try {
          const adapter = await deps.brokerRegistry.get(brokerAccountId);
          if (!adapter.getOhlcv) {
            return {
              error: `Broker does not support OHLCV for ${instrumentClass}. Use get_quote for current price.`,
            };
          }
          const canonicalSymbol = resolveCanonicalSymbol(
            symbol,
            instrumentClass,
          );
          const brokerSymbol = instrumentNormalizer.toBrokerSymbol({
            symbol: canonicalSymbol,
            instrumentClass,
            brokerType: adapter.brokerType,
          });
          const bars = await adapter.getOhlcv(
            brokerSymbol,
            timeframe as "1h" | "4h" | "1d",
            200,
          );
          return {
            symbol,
            canonicalSymbol,
            brokerSymbol,
            instrumentClass,
            timeframe,
            bars,
          };
        } catch (error) {
          return toToolError(error);
        }
      },
    });
  }

  return out;
}

function toToolError(error: unknown): { error: string } {
  return { error: error instanceof Error ? error.message : String(error) };
}
