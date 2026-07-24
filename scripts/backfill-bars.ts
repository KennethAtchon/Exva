#!/usr/bin/env bun
/**
 * Populate OHLCV bars through the same historical backfill service as the UI.
 *
 * better-sqlite3 is built for Electron's Node ABI — run under Electron:
 *   ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron \
 *     ./node_modules/vite-node/vite-node.mjs --config vitest.config.ts \
 *     scripts/backfill-bars.ts SPY 1h 2026-01-01 2026-07-01
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { createDbClient } from "../electron/main/db/client";
import { AlpacaAdapter } from "../electron/main/services/broker/adapters/alpaca-adapter";
import {
  InstrumentNormalizer,
  resolveCanonicalSymbol,
} from "../electron/main/services/broker/instrument-normalizer";
import type { EventBus } from "../electron/main/services/infra/event-bus";
import { HistoricalBackfillService } from "../electron/main/services/marketdata/historical-backfill-service";
import { MarketDataService } from "../electron/main/services/marketdata/market-data-service";
import type { TradingTimeframe } from "../electron/shared/domain/enums";

const [symbol, timeframe, start, end] = process.argv.slice(2);
const validTimeframes = new Set(["5m", "15m", "30m", "1h", "4h", "1d", "1w"]);

if (
  !symbol ||
  !timeframe ||
  !start ||
  !end ||
  !validTimeframes.has(timeframe)
) {
  throw new Error(
    "Usage: bun scripts/backfill-bars.ts <symbol> <15m|30m|1h|4h|1d|1w> <YYYY-MM-DD> <YYYY-MM-DD>",
  );
}

const apiKey = process.env.ALPACA_API_KEY;
const secretKey = process.env.ALPACA_SECRET_KEY;
if (!apiKey || !secretKey) {
  throw new Error("ALPACA_API_KEY and ALPACA_SECRET_KEY are required.");
}

const db = createDbClient(
  process.env.EXVA_USER_DATA_DIR ??
    join(homedir(), "Library", "Application Support", "exva"),
);
const noOpEventBus: Pick<EventBus, "emit"> = { emit: () => undefined };
try {
  const normalizer = new InstrumentNormalizer();
  const adapter = new AlpacaAdapter({
    provider: "alpaca",
    api_key: apiKey,
    secret_key: secretKey,
    mode: "paper",
  });
  const service = new HistoricalBackfillService({
    marketData: new MarketDataService(db),
    eventBus: noOpEventBus,
    resolveAdapter: async () => adapter,
    normalizeWireSymbol: ({ symbol, instrumentClass, brokerType }) =>
      normalizer.toBrokerSymbol({
        symbol: resolveCanonicalSymbol(symbol, instrumentClass),
        instrumentClass,
        brokerType,
      }),
  });
  const result = await service.backfill({
    symbol,
    instrumentClass: symbol.includes("-") ? "crypto" : "stock",
    timeframe: timeframe as TradingTimeframe,
    startIso: new Date(`${start}T00:00:00.000Z`).toISOString(),
    endIso: new Date(`${end}T00:00:00.000Z`).toISOString(),
  });
  console.log(
    `Backfilled ${symbol} ${timeframe}: ${result.barsWritten} bars across ${result.chunks} chunks.`,
  );
} finally {
  db.sqlite.close();
}
