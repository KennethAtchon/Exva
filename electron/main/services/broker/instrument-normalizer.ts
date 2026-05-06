import type { InstrumentClass } from "@/lib/types";
import { AppError } from "@electron/shared/errors";

export type CanonicalInstrument = {
  symbol: string;
  instrumentClass: InstrumentClass;
};

export class InstrumentNormalizer {
  /** Wire-format symbol for a specific broker implementation. */
  toBrokerSymbol(input: { symbol: string; instrumentClass: InstrumentClass; brokerType: string }): string {
    if (input.instrumentClass === "prediction_market") {
      return input.symbol.trim();
    }
    const s = input.symbol.trim().toUpperCase();
    switch (input.brokerType) {
      case "alpaca":
        if (input.instrumentClass !== "stock") {
          throw new AppError("Alpaca routing received a non-stock instrument", "UNSUPPORTED_INSTRUMENT");
        }
        return s.replace(/-/g, "");
      case "coinbase_advanced_trade":
        if (input.instrumentClass !== "crypto") {
          throw new AppError("Coinbase routing received a non-crypto instrument", "UNSUPPORTED_INSTRUMENT");
        }
        return s.includes("-") ? s : `${s}-USD`;
      case "tradovate":
        if (input.instrumentClass !== "futures") {
          throw new AppError("Tradovate routing received a non-futures instrument", "UNSUPPORTED_INSTRUMENT");
        }
        return s;
      case "mock":
        return s;
      default:
        return s;
    }
  }
}
