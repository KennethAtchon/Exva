import type { InstrumentClass, SessionConfig, WorkspaceSession } from "@/lib/types";
import { AppError } from "@electron/shared/infra/errors";
import type { ResolvedInstrument } from "../types";

export function parseManualShortlist(session: WorkspaceSession, config: SessionConfig): ResolvedInstrument[] {
  const symbols = session.instrumentScope
    .split(/[\n,]+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const out: ResolvedInstrument[] = [];
  for (const line of symbols) {
    const parsed = parseManualInstrumentLine(line, session.instrumentClasses);
    if (!session.instrumentClasses.includes(parsed.instrumentClass)) continue;
    out.push(parsed);
  }
  if (out.length === 0) {
    throw new AppError("Manual instrument shortlist is empty after parsing.", "VALIDATION_FAILED");
  }
  return out.slice(0, config.max_concurrent_trades);
}

function inferInstrumentClass(symbol: string, classes: InstrumentClass[]): InstrumentClass {
  if (classes.length === 1) return classes[0] ?? "stock";
  const upper = symbol.toUpperCase();
  if (classes.includes("crypto") && upper.includes("-")) return "crypto";
  if (classes.includes("futures") && /^[A-Z]{2,4}[FGHJKMNQUVXZ]\d{1,2}$/i.test(upper)) return "futures";
  if (classes.includes("prediction_market") && symbol.startsWith("pm:")) return "prediction_market";
  if (classes.includes("stock")) return "stock";
  return classes[0] ?? "stock";
}

function parseManualInstrumentLine(line: string, classes: InstrumentClass[]): ResolvedInstrument {
  if (line.startsWith("{")) {
    try {
      const parsed = JSON.parse(line) as ResolvedInstrument;
      return {
        symbol: parsed.symbol,
        instrumentClass: parsed.instrumentClass,
        instrumentDisplayName: parsed.instrumentDisplayName,
        predictionOutcome: parsed.predictionOutcome ?? null,
        instrumentMetadataJson: parsed.instrumentMetadataJson ?? null,
      };
    } catch {
      // Malformed JSON — fall through and treat as a plain symbol
    }
  }
  const symbol = line.startsWith("pm:") ? line : line.toUpperCase();
  return {
    symbol,
    instrumentClass: inferInstrumentClass(symbol, classes),
  };
}
