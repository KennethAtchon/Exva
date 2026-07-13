import type { InstrumentClass, WorkspaceSession } from "@/lib/types";
import type { InstrumentSelection } from "@/lib/schemas";
import { AppError } from "@electron/shared/infra/errors";
import { classifyInstrumentBySymbol } from "@electron/shared/instruments/instrument-classification";
import type { AIPhaseContext } from "../../phases/types";
import { registerEngine, type EntryModeEngine } from "../registry";

function buildManualShortlistSelection(
  session: WorkspaceSession,
  maxConcurrentTrades: number,
): InstrumentSelection {
  const symbols = session.instrumentScope
    .split(/[\n,]+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const instruments: InstrumentSelection["instruments"] = [];
  for (const line of symbols) {
    const parsed = parseManualInstrumentLine(line);
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

function isManualSelectorMode(ctx: AIPhaseContext): boolean {
  if (ctx.session.selectionMode === "signal_driven") {
    return false;
  }
  const signalTrigger = ctx.input.signalTrigger;
  if (
    signalTrigger &&
    typeof signalTrigger === "object" &&
    "sourceType" in signalTrigger
  ) {
    return false;
  }
  const selectorSettings =
    ctx.services.strategyContextService.getSelectorSettings(ctx.sessionId);
  return (
    ctx.session.selectionMode === "manual_shortlist" ||
    !selectorSettings.aiPickerEnabled
  );
}

const manualShortlistEntryEngine: EntryModeEngine = {
  id: "manual-shortlist",
  kind: "entry_mode",
  source: "manual_shortlist",
  matches: isManualSelectorMode,
  resolve(ctx) {
    return buildManualShortlistSelection(
      ctx.session,
      ctx.strategyContext.riskConfig.maxConcurrentTrades,
    );
  },
};

registerEngine(manualShortlistEntryEngine);

function parseManualInstrumentLine(line: string): {
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
    instrumentClass: classifyInstrumentBySymbol(symbol),
  };
}
