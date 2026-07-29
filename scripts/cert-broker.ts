/**
 * Real-broker certification CLI.
 *
 * Usage:
 *   bun run cert:broker -- mock
 *   bun run cert:broker -- kalshi
 *   bun run cert:broker -- tradier
 *   bun run cert:broker -- kraken
 *   bun run cert:broker -- alpaca
 *
 * Required env (fails LOUD if missing for non-mock):
 *   Kalshi:  KALSHI_KEY_ID, KALSHI_PRIVATE_KEY_PEM  (optional KALSHI_MODE=paper|live)
 *   Tradier: TRADIER_ACCESS_TOKEN, TRADIER_ACCOUNT_ID  (optional TRADIER_MODE=paper|live)
 *   Kraken:  KRAKEN_API_KEY, KRAKEN_API_SECRET  (paper uses validate-only)
 *   Alpaca:  ALPACA_API_KEY, ALPACA_SECRET_KEY  (optional ALPACA_MODE=paper|live)
 */

import { MockBrokerAdapter } from "../electron/main/services/broker/adapters/mock-adapter";
import { KalshiAdapter } from "../electron/main/services/broker/adapters/kalshi-adapter";
import { TradierAdapter } from "../electron/main/services/broker/adapters/tradier-adapter";
import { KrakenAdapter } from "../electron/main/services/broker/adapters/kraken-adapter";
import { AlpacaAdapter } from "../electron/main/services/broker/adapters/alpaca-adapter";
import {
  formatCertReport,
  runAdapterCertification,
} from "../electron/main/services/broker/__tests__/adapter-certification";
import type { BrokerAdapter } from "../electron/main/services/broker/adapters/broker-adapter";

const name = (process.argv[2] ?? "").toLowerCase().replace(/^--/, "");

function requireEnv(keys: string[], broker: string): Record<string, string> {
  const missing = keys.filter((k) => !process.env[k]?.trim());
  if (missing.length > 0) {
    console.error(`
╔══════════════════════════════════════════════════════════════════╗
║  cert:broker — MISSING CREDENTIALS for ${broker.padEnd(26)}║
╠══════════════════════════════════════════════════════════════════╣
║  Set these environment variables, then re-run:                   ║
${
  missing
    .map((k) => `║    export ${k}=...`)
    .join("\n")
    .padEnd(69) + "║"
}
║                                                                  ║
║  Demo/sandbox keys only — never silently skip.                   ║
║  Example: bun run cert:broker -- ${broker}                       ║
╚══════════════════════════════════════════════════════════════════╝
`);
    process.exitCode = 2;
    // Keep process alive long enough for the banner to flush, then exit.
    setTimeout(() => process.exit(2), 0);
    return {} as Record<string, string>;
  }
  return Object.fromEntries(keys.map((k) => [k, process.env[k]!.trim()]));
}

async function buildAdapter(): Promise<{
  adapter: BrokerAdapter;
  symbol: string;
  instrumentClass: "stock" | "crypto" | "prediction_market" | "options";
  trade: boolean;
}> {
  switch (name) {
    case "mock":
      return {
        adapter: new MockBrokerAdapter({ bias: "bullish" }),
        symbol: "AAPL",
        instrumentClass: "stock",
        trade: true,
      };
    case "kalshi": {
      const env = requireEnv(
        ["KALSHI_KEY_ID", "KALSHI_PRIVATE_KEY_PEM"],
        "kalshi",
      );
      const mode =
        process.env.KALSHI_MODE === "live" ? ("live" as const) : "paper";
      return {
        adapter: new KalshiAdapter(
          {
            keyId: env.KALSHI_KEY_ID,
            privateKeyPem: env.KALSHI_PRIVATE_KEY_PEM.replace(/\\n/g, "\n"),
          },
          mode,
        ),
        symbol: process.env.KALSHI_CERT_TICKER ?? "KXBTCD-99999999-T0",
        instrumentClass: "prediction_market",
        trade: true,
      };
    }
    case "tradier": {
      const env = requireEnv(
        ["TRADIER_ACCESS_TOKEN", "TRADIER_ACCOUNT_ID"],
        "tradier",
      );
      const mode =
        process.env.TRADIER_MODE === "live" ? ("live" as const) : "paper";
      return {
        adapter: new TradierAdapter(
          {
            accessToken: env.TRADIER_ACCESS_TOKEN,
            accountId: env.TRADIER_ACCOUNT_ID,
          },
          mode,
        ),
        symbol: process.env.TRADIER_CERT_SYMBOL ?? "AAPL",
        instrumentClass: "stock",
        trade: true,
      };
    }
    case "kraken": {
      const env = requireEnv(["KRAKEN_API_KEY", "KRAKEN_API_SECRET"], "kraken");
      return {
        adapter: new KrakenAdapter(
          {
            apiKey: env.KRAKEN_API_KEY,
            apiSecret: env.KRAKEN_API_SECRET,
          },
          "paper",
        ),
        symbol: process.env.KRAKEN_CERT_SYMBOL ?? "BTC/USD",
        instrumentClass: "crypto",
        trade: true,
      };
    }
    case "alpaca": {
      const env = requireEnv(["ALPACA_API_KEY", "ALPACA_SECRET_KEY"], "alpaca");
      const mode =
        process.env.ALPACA_MODE === "live" ? ("live" as const) : "paper";
      return {
        adapter: new AlpacaAdapter({
          provider: "alpaca",
          api_key: env.ALPACA_API_KEY,
          secret_key: env.ALPACA_SECRET_KEY,
          mode,
        }),
        symbol: process.env.ALPACA_CERT_SYMBOL ?? "AAPL",
        instrumentClass: "stock",
        trade: true,
      };
    }
    default:
      console.error(
        `Usage: bun run cert:broker -- <mock|kalshi|tradier|kraken|alpaca>\nGot: ${name || "(empty)"}`,
      );
      process.exit(1);
  }
}

const { adapter, symbol, instrumentClass, trade } = await buildAdapter();
const report = await runAdapterCertification({
  adapter,
  symbol,
  instrumentClass,
  trade,
  fillTimeoutMs: 20_000,
});
console.log(formatCertReport(report));
process.exitCode = report.passed ? 0 : 1;
