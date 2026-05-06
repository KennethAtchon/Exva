import { tool } from "ai";
import { z } from "zod";
import type { InstrumentClass } from "@/lib/types";
import type { BrokerRegistry } from "../../broker/broker-registry";

const instrumentClassSchema = z.enum(["stock", "crypto", "futures", "prediction_market"]);

export function createMarketTools(deps: {
  brokerRegistry: BrokerRegistry;
  brokerAccountIdByClass: (instrumentClass: InstrumentClass) => string | null;
}) {
  const get_quote = tool({
    description: "Get current price and basic quote data for a symbol.",
    inputSchema: z.object({ symbol: z.string(), instrumentClass: instrumentClassSchema }),
    execute: async ({ symbol, instrumentClass }: { symbol: string; instrumentClass: InstrumentClass }) => {
      const brokerAccountId = deps.brokerAccountIdByClass(instrumentClass);
      if (!brokerAccountId) return { error: "No broker account routing available for this instrument class." };
      try {
        const adapter = await deps.brokerRegistry.get(brokerAccountId);
        const snap = await adapter.getMarketSnapshot(symbol);
        return snap;
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) };
      }
    },
  });

  const get_ohlcv = tool({
    description: "Get OHLCV bars for a symbol. Returns up to 200 daily bars.",
    inputSchema: z.object({ symbol: z.string(), instrumentClass: instrumentClassSchema }),
    execute: async () => ({ error: "OHLCV provider not configured yet for tool path." }),
  });

  const get_news = tool({
    description: "Get recent news headlines for a symbol.",
    inputSchema: z.object({ symbol: z.string() }),
    execute: async () => ({ error: "News provider not configured yet for tool path." }),
  });

  return { get_quote, get_ohlcv, get_news };
}
