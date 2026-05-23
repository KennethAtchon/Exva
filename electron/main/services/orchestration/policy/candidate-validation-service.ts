import type { InstrumentClass } from "@/lib/types";
import type { HoldingStyle, StrategySideBias } from "@electron/shared/domain";
import type { SelectorEvidence } from "@electron/shared/ai/selector-candidate";
import type { MarketSnapshot } from "../../broker/adapters/broker-adapter";

export type ToolLLMToolStepTrace = {
  step: number;
  toolCalls: Array<{
    step: number;
    tool: string;
    argsJson: string;
    resultJson: string;
  }>;
};

export interface CandidateValidationInput {
  sessionId: string;
  cycleId: string;
  instrument: {
    symbol: string;
    instrumentClass: InstrumentClass;
    selectorEvidence?: SelectorEvidence | null;
  };
  sessionInstrumentClasses?: InstrumentClass[];
  brokerRouteAvailable?: boolean;
  sideBias?: StrategySideBias;
  holdingStyle?: HoldingStyle;
  selectorTrace: ToolLLMToolStepTrace[];
  quoteSnapshot: MarketSnapshot;
  now?: string;
}

export interface CandidateEvidenceEntry {
  source: "get_news" | "search_web" | "get_quote" | "fetch_url";
  symbolMatched: boolean;
  publishedAt?: string;
}

export interface CandidateValidationResult {
  allowed: boolean;
  reasons: string[];
  evidence: CandidateEvidenceEntry[];
  quoteSnapshot: MarketSnapshot;
}

const MAX_QUOTE_AGE_MS: Record<
  InstrumentClass,
  Record<"intraday" | "swing" | "position", number>
> = {
  stock: { intraday: 30_000, swing: 300_000, position: 600_000 },
  crypto: { intraday: 15_000, swing: 120_000, position: 300_000 },
  futures: { intraday: 15_000, swing: 120_000, position: 300_000 },
  prediction_market: { intraday: 300_000, swing: 600_000, position: 3_600_000 },
};

const MIN_VOLUME: Partial<Record<InstrumentClass, number>> = {
  stock: 50_000,
  crypto: 10_000,
  futures: 500,
};

const MAX_SPREAD_PCT: Partial<Record<InstrumentClass, number>> = {
  stock: 0.5,
  crypto: 1.0,
  futures: 0.3,
};

function maxQuoteAgeMs(
  cls: InstrumentClass,
  holdingStyle?: HoldingStyle,
): number {
  const bucket: "intraday" | "swing" | "position" =
    holdingStyle === "intraday_flat"
      ? "intraday"
      : holdingStyle === "multi_day_swing"
        ? "swing"
        : "position";
  return MAX_QUOTE_AGE_MS[cls][bucket];
}

export class CandidateValidationService {
  validate(input: CandidateValidationInput): CandidateValidationResult {
    const reasons: string[] = [];
    const evidence: CandidateEvidenceEntry[] = [];
    const { instrument, quoteSnapshot, selectorTrace, now } = input;
    const cls = instrument.instrumentClass;
    const nowMs = now ? new Date(now).getTime() : Date.now();

    // CV-1: Symbol present
    if (!instrument.symbol?.trim()) {
      reasons.push("Missing instrument symbol");
    }

    // CV-2: Class enabled
    if (
      input.sessionInstrumentClasses &&
      !input.sessionInstrumentClasses.includes(cls)
    ) {
      reasons.push(`Instrument class '${cls}' not enabled for session`);
    }

    // CV-3: Broker route available
    if (input.brokerRouteAvailable === false) {
      reasons.push("No broker account supports this instrument class");
    }

    // CV-4: Quote success
    if (!(quoteSnapshot.price > 0)) {
      reasons.push("Quote price is zero or missing");
    }

    // CV-5: Quote freshness
    if (quoteSnapshot.price > 0) {
      const quoteAgeMs = nowMs - new Date(quoteSnapshot.timestamp).getTime();
      const maxAgeMs = maxQuoteAgeMs(cls, input.holdingStyle);
      if (quoteAgeMs > maxAgeMs) {
        reasons.push(
          `Quote is stale (age: ${Math.round(quoteAgeMs / 1000)}s, max: ${Math.round(maxAgeMs / 1000)}s)`,
        );
      }
    }

    // CV-6: Symbol-specific evidence
    const hasNewsEvidence = selectorTrace.some((step) =>
      step.toolCalls.some((call) => {
        if (call.tool !== "get_news") return false;
        const args = safeParseJson(call.argsJson);
        const result = safeParseJson(call.resultJson);
        const matched =
          args?.symbol === instrument.symbol &&
          result != null &&
          !Object.hasOwn(result, "error");
        if (matched) evidence.push({ source: "get_news", symbolMatched: true });
        return matched;
      }),
    );
    const hasSearchEvidence = selectorTrace.some((step) =>
      step.toolCalls.some((call) => {
        if (call.tool !== "search_web") return false;
        const matched = call.resultJson.includes(instrument.symbol);
        if (matched)
          evidence.push({ source: "search_web", symbolMatched: true });
        return matched;
      }),
    );
    // Fallback: use typed selector evidence when traces are unavailable
    const structuredEvidence = instrument.selectorEvidence;
    const hasStructuredEvidence =
      structuredEvidence?.hasNewsEvidence ||
      structuredEvidence?.hasSearchEvidence ||
      structuredEvidence?.hasQuoteEvidence ||
      structuredEvidence?.hasOhlcvEvidence ||
      structuredEvidence?.hasFetchEvidence;
    if (!hasNewsEvidence && !hasSearchEvidence && !hasStructuredEvidence) {
      reasons.push(
        `No symbol-specific evidence found for ${instrument.symbol}`,
      );
    }

    // CV-7: Rationale non-empty when structured evidence is present
    if (
      structuredEvidence != null &&
      !structuredEvidence.summary?.trim()
    ) {
      reasons.push("Selector rationale is empty");
    }

    // CV-8: Liquidity (when volume available)
    const minVol = MIN_VOLUME[cls];
    if (
      quoteSnapshot.volume != null &&
      minVol != null &&
      quoteSnapshot.volume < minVol
    ) {
      reasons.push(`Volume too low (${quoteSnapshot.volume}, min: ${minVol})`);
    }

    // CV-9: Spread (when bid/ask available)
    const maxSpread = MAX_SPREAD_PCT[cls];
    if (
      quoteSnapshot.spreadPct != null &&
      maxSpread != null &&
      quoteSnapshot.spreadPct > maxSpread
    ) {
      reasons.push(
        `Spread too wide (${quoteSnapshot.spreadPct.toFixed(2)}%, max: ${maxSpread}%)`,
      );
    }

    // CV-10: Strategy compatibility
    if (input.sideBias) {
      const thesisDirection = structuredEvidence?.thesisDirection ?? "neutral";
      if (input.sideBias === "long_only" && thesisDirection === "short") {
        reasons.push("Rationale contradicts long_only bias");
      }
      if (input.sideBias === "short_only" && thesisDirection === "long") {
        reasons.push("Rationale contradicts short_only bias");
      }
    }

    return {
      allowed: reasons.length === 0,
      reasons,
      evidence,
      quoteSnapshot,
    };
  }
}

function safeParseJson(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}
