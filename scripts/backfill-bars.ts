#!/usr/bin/env bun
/**
 * Populate OHLCV bars through the same historical backfill service as the UI.
 *
 * better-sqlite3 is built for Electron's Node ABI — run under Electron:
 *   ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron \
 *     ./node_modules/vite-node/vite-node.mjs --config vitest.config.ts \
 *     scripts/backfill-bars.ts SPY 1h 2026-01-01 2026-07-01
 *
 * Universe modes (Solution 06 WS5):
 *   --set liquid-us-etfs --timeframe 1h --lookback 2y
 *   --audit SPY 1h
 *   Single-symbol mode remains: <symbol> <timeframe> <start> <end>
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

const LIQUID_US_ETFS = [
  "SPY",
  "QQQ",
  "IWM",
  "DIA",
  "XLK",
  "XLF",
  "XLE",
  "XLV",
  "XLI",
  "XLY",
  "XLP",
  "XLU",
  "XLB",
  "XLRE",
  "SMH",
  "XBI",
  "ARKK",
  "EEM",
  "EFA",
  "TLT",
  "HYG",
  "GLD",
  "USO",
  "TQQQ",
  "SQQQ",
] as const;

const args = process.argv.slice(2);
const validTimeframes = new Set(["5m", "15m", "30m", "1h", "4h", "1d", "1w"]);

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
const marketData = new MarketDataService(db);

function buildService() {
  const normalizer = new InstrumentNormalizer();
  const adapter = new AlpacaAdapter({
    provider: "alpaca",
    api_key: apiKey!,
    secret_key: secretKey!,
    mode: "paper",
  });
  return new HistoricalBackfillService({
    marketData,
    eventBus: noOpEventBus,
    resolveAdapter: async () => adapter,
    normalizeWireSymbol: ({ symbol, instrumentClass, brokerType }) =>
      normalizer.toBrokerSymbol({
        symbol: resolveCanonicalSymbol(symbol, instrumentClass),
        instrumentClass,
        brokerType,
      }),
  });
}

function parseLookback(raw: string | undefined): { start: string; end: string } {
  const end = new Date();
  const lookback = raw ?? "2y";
  const match = /^(\d+)([ymd])$/i.exec(lookback);
  if (!match) {
    throw new Error(`Invalid --lookback ${lookback}; use e.g. 2y, 6m, 30d`);
  }
  const n = Number(match[1]);
  const unit = match[2]!.toLowerCase();
  const start = new Date(end);
  if (unit === "y") start.setUTCFullYear(start.getUTCFullYear() - n);
  else if (unit === "m") start.setUTCMonth(start.getUTCMonth() - n);
  else start.setUTCDate(start.getUTCDate() - n);
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}

try {
  if (args[0] === "--audit") {
    const symbol = args[1];
    const timeframe = args[2];
    if (!symbol || !timeframe || !validTimeframes.has(timeframe)) {
      throw new Error("Usage: --audit <symbol> <timeframe>");
    }
    const coverage = marketData.getCoverage(symbol, timeframe);
    console.log(
      coverage
        ? `AUDIT ${symbol} ${timeframe}: ${coverage.firstTs} → ${coverage.lastTs} (${coverage.provider})`
        : `AUDIT ${symbol} ${timeframe}: no coverage`,
    );
  } else if (args[0] === "--set") {
    const setName = args[1];
    const tfIdx = args.indexOf("--timeframe");
    const lookIdx = args.indexOf("--lookback");
    const timeframe = (tfIdx >= 0 ? args[tfIdx + 1] : "1h") as TradingTimeframe;
    const lookback = lookIdx >= 0 ? args[lookIdx + 1] : "2y";
    if (!setName || !validTimeframes.has(timeframe)) {
      throw new Error(
        "Usage: --set <liquid-us-etfs> --timeframe 1h --lookback 2y",
      );
    }
    if (setName !== "liquid-us-etfs") {
      throw new Error(`Unknown set "${setName}"; supported: liquid-us-etfs`);
    }
    const { start, end } = parseLookback(lookback);
    const service = buildService();
    for (const symbol of LIQUID_US_ETFS) {
      const result = await service.backfill({
        symbol,
        instrumentClass: "stock",
        timeframe,
        startIso: new Date(`${start}T00:00:00.000Z`).toISOString(),
        endIso: new Date(`${end}T00:00:00.000Z`).toISOString(),
      });
      console.log(
        `Backfilled ${symbol} ${timeframe}: ${result.barsWritten} bars across ${result.chunks} chunks.`,
      );
    }
  } else {
    const [symbol, timeframe, start, end] = args;
    if (
      !symbol ||
      !timeframe ||
      !start ||
      !end ||
      !validTimeframes.has(timeframe)
    ) {
      throw new Error(
        "Usage: bun scripts/backfill-bars.ts <symbol> <15m|30m|1h|4h|1d|1w> <YYYY-MM-DD> <YYYY-MM-DD>\n" +
          "   or: --set liquid-us-etfs --timeframe 1h --lookback 2y\n" +
          "   or: --audit <symbol> <timeframe>",
      );
    }
    const service = buildService();
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
  }
} finally {
  db.sqlite.close();
}
