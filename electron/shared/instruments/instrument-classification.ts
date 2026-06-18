import type { InstrumentClass } from "../domain/enums";

const INSTRUMENT_CLASSES: readonly InstrumentClass[] = [
  "stock",
  "crypto",
  "futures",
  "options",
  "prediction_market",
];

export function isInstrumentClass(value: unknown): value is InstrumentClass {
  return (
    typeof value === "string" &&
    INSTRUMENT_CLASSES.includes(value as InstrumentClass)
  );
}

/**
 * Infer an instrument class from a bare symbol's *shape* alone — no session or
 * broker context. Routing/the delivery gate decide tradability afterwards, so
 * this only needs to read the symbol honestly rather than coerce it to fit a
 * session's configured classes.
 *
 * Order matters: the more specific shapes are checked first.
 */
export function classifyInstrumentBySymbol(symbol: string): InstrumentClass {
  const trimmed = symbol.trim();
  // Prediction markets use an explicit `pm:` prefix and keep their casing.
  if (trimmed.startsWith("pm:")) return "prediction_market";

  const upper = trimmed.toUpperCase();
  // OCC option symbols: <root><yymmdd><C|P><strike padded to 8>.
  if (/\d{6}[CP]\d{8}$/.test(upper)) return "options";
  // Crypto pairs: a slash (BTC/USD) or a fiat/stablecoin quote suffix (BTC-USD).
  if (upper.includes("/") || /[-/](USD|USDT|USDC)$/.test(upper)) return "crypto";
  // Futures: root + month code (FGHJKMNQUVXZ) + 1–2 digit year, e.g. ESH5.
  if (/^[A-Z]{2,4}[FGHJKMNQUVXZ]\d{1,2}$/.test(upper)) return "futures";
  return "stock";
}
