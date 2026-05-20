import type { InstrumentClass, WorkspaceSession } from "@/lib/types";
import type { InstrumentSelection } from "@/lib/schemas";
import { AppError } from "@electron/shared/infra/errors";
import type { PhasePlanRunContext } from "../phase/types";

export function buildManualShortlistSelection(
  session: WorkspaceSession,
  maxConcurrentTrades: number,
): InstrumentSelection {
  const symbols = session.instrumentScope
    .split(/[\n,]+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const instruments: InstrumentSelection["instruments"] = [];
  for (const line of symbols) {
    const parsed = parseManualInstrumentLine(line, session.instrumentClasses);
    if (!session.instrumentClasses.includes(parsed.instrumentClass)) continue;
    instruments.push({
      symbol: parsed.symbol,
      instrumentClass: parsed.instrumentClass,
      instrumentDisplayName: parsed.instrumentDisplayName,
      predictionOutcome: parsed.predictionOutcome ?? undefined,
      instrumentMetadataJson: parsed.instrumentMetadataJson ?? undefined,
    });
  }

  if (instruments.length === 0) {
    throw new AppError(
      "Manual instrument shortlist is empty after parsing.",
      "VALIDATION_FAILED",
    );
  }

  return {
    instruments: instruments.slice(0, maxConcurrentTrades),
  };
}

export function isManualSelectorMode(ctx: PhasePlanRunContext): boolean {
  const selectorSettings = ctx.services.sessionSelectorSettingsRepo.get(
    ctx.sessionId,
  );
  return (
    ctx.session.selectionMode === "manual_shortlist" ||
    !selectorSettings.aiPickerEnabled
  );
}

function inferInstrumentClass(
  symbol: string,
  classes: InstrumentClass[],
): InstrumentClass {
  if (classes.length === 1) return classes[0] ?? "stock";
  const upper = symbol.toUpperCase();
  if (classes.includes("crypto") && upper.includes("-")) return "crypto";
  if (
    classes.includes("futures") &&
    /^[A-Z]{2,4}[FGHJKMNQUVXZ]\d{1,2}$/i.test(upper)
  )
    return "futures";
  if (classes.includes("prediction_market") && symbol.startsWith("pm:"))
    return "prediction_market";
  if (classes.includes("stock")) return "stock";
  return classes[0] ?? "stock";
}

function parseManualInstrumentLine(
  line: string,
  classes: InstrumentClass[],
): {
  symbol: string;
  instrumentClass: InstrumentClass;
  instrumentDisplayName?: string;
  predictionOutcome?: "YES" | "NO" | null;
  instrumentMetadataJson?: string | null;
} {
  if (line.startsWith("{")) {
    try {
      const parsed = JSON.parse(line) as {
        symbol: string;
        instrumentClass: InstrumentClass;
        instrumentDisplayName?: string;
        predictionOutcome?: "YES" | "NO" | null;
        instrumentMetadataJson?: string | null;
      };
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
