import type { InstrumentClass } from "@/lib/types";
import type {
  DecisionCheck,
  HoldingStyle,
  StrategySideBias,
} from "@electron/shared/domain";
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
  /**
   * Where this instrument came from. Only researcher-discovered instruments
   * (`ai_picker`) must carry symbol-specific search evidence; instruments
   * supplied by an entry engine (signal-seeded, manual shortlist) must not.
   */
  selectionSource?: string;
  selectorTrace: ToolLLMToolStepTrace[];
  quoteSnapshot: MarketSnapshot;
  now?: string;
}

interface CandidateEvidenceEntry {
  source: "search_web" | "get_quote" | "fetch_url";
  symbolMatched: boolean;
  publishedAt?: string;
}

export interface CandidateValidationResult {
  allowed: boolean;
  reasons: string[];
  /** Per-rule pass/fail trace for observability (decision-trace panel). */
  checks: DecisionCheck[];
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
  // Options quotes decay fast (theta); keep age bounds as tight as futures.
  options: { intraday: 15_000, swing: 120_000, position: 300_000 },
  prediction_market: { intraday: 300_000, swing: 600_000, position: 3_600_000 },
};

const MIN_VOLUME: Partial<Record<InstrumentClass, number>> = {
  stock: 50_000,
  crypto: 10_000,
  futures: 500,
  // Single contracts trade far thinner than shares; a low floor still screens dead strikes.
  options: 100,
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
    holdingStyle === "multi_day_swing" ? "swing" : "position";
  return MAX_QUOTE_AGE_MS[cls][bucket];
}

export class CandidateValidationService {
  validate(input: CandidateValidationInput): CandidateValidationResult {
    const checks: DecisionCheck[] = [];
    const evidence: CandidateEvidenceEntry[] = [];
    const { instrument, quoteSnapshot, selectorTrace, now } = input;
    const cls = instrument.instrumentClass;
    const nowMs = now ? new Date(now).getTime() : Date.now();

    const record = (
      id: string,
      label: string,
      pass: boolean,
      detail: string | null,
      extra?: Pick<DecisionCheck, "value" | "threshold">,
    ): void => {
      checks.push({ id, label, pass, detail, ...extra });
    };

    // CV-1: Symbol present
    record(
      "CV-1",
      "Symbol present",
      Boolean(instrument.symbol?.trim()),
      instrument.symbol?.trim() ? null : "Missing instrument symbol",
    );

    // CV-2: Class enabled
    if (input.sessionInstrumentClasses) {
      const enabled = input.sessionInstrumentClasses.includes(cls);
      record(
        "CV-2",
        "Class enabled",
        enabled,
        enabled ? null : `Instrument class '${cls}' not enabled for session`,
        { value: cls },
      );
    }

    // CV-3: Broker route available
    if (input.brokerRouteAvailable != null) {
      record(
        "CV-3",
        "Broker route",
        input.brokerRouteAvailable,
        input.brokerRouteAvailable
          ? null
          : "No broker account supports this instrument class",
      );
    }

    // CV-4: Quote success
    const priceOk = quoteSnapshot.price > 0;
    record(
      "CV-4",
      "Quote present",
      priceOk,
      priceOk ? null : "Quote price is zero or missing",
      { value: quoteSnapshot.price },
    );

    // CV-5: Quote freshness
    if (priceOk) {
      const quoteAgeMs = nowMs - new Date(quoteSnapshot.timestamp).getTime();
      const maxAgeMs = maxQuoteAgeMs(cls, input.holdingStyle);
      const fresh = quoteAgeMs <= maxAgeMs;
      record(
        "CV-5",
        "Quote freshness",
        fresh,
        fresh
          ? null
          : `Quote is stale (age: ${Math.round(quoteAgeMs / 1000)}s, max: ${Math.round(maxAgeMs / 1000)}s)`,
        {
          value: `${Math.round(quoteAgeMs / 1000)}s`,
          threshold: `${Math.round(maxAgeMs / 1000)}s`,
        },
      );
    }

    const structuredEvidence = instrument.selectorEvidence;

    // CV-6: Symbol-specific evidence. Required only for researcher-discovered
    // instruments; an instrument supplied by an entry engine (signal-seeded,
    // manual shortlist) is not required to carry search evidence.
    if (input.selectionSource === "ai_picker") {
      const hasSearchEvidence = selectorTrace.some((step) =>
        step.toolCalls.some((call) => {
          if (call.tool !== "search_web") return false;
          const matched = call.resultJson.includes(instrument.symbol);
          if (matched)
            evidence.push({ source: "search_web", symbolMatched: true });
          return matched;
        }),
      );
      const hasStructuredEvidence =
        structuredEvidence?.hasSearchEvidence ||
        structuredEvidence?.hasQuoteEvidence ||
        structuredEvidence?.hasOhlcvEvidence ||
        structuredEvidence?.hasFetchEvidence;
      const evidenceOk = Boolean(hasSearchEvidence || hasStructuredEvidence);
      record(
        "CV-6",
        "Symbol evidence",
        evidenceOk,
        evidenceOk
          ? null
          : `No symbol-specific evidence found for ${instrument.symbol}`,
      );
    }

    // CV-7: Rationale non-empty when structured evidence is present
    if (structuredEvidence != null) {
      const rationaleOk = Boolean(structuredEvidence.summary?.trim());
      record(
        "CV-7",
        "Rationale present",
        rationaleOk,
        rationaleOk ? null : "Selector rationale is empty",
      );
    }

    // CV-8: Liquidity (when volume available)
    const minVol = MIN_VOLUME[cls];
    if (quoteSnapshot.volume != null && minVol != null) {
      const liquidOk = quoteSnapshot.volume >= minVol;
      record(
        "CV-8",
        "Liquidity",
        liquidOk,
        liquidOk
          ? null
          : `Volume too low (${quoteSnapshot.volume}, min: ${minVol})`,
        { value: quoteSnapshot.volume, threshold: minVol },
      );
    }

    // CV-9: Spread (when bid/ask available)
    const maxSpread = MAX_SPREAD_PCT[cls];
    if (quoteSnapshot.spreadPct != null && maxSpread != null) {
      const spreadOk = quoteSnapshot.spreadPct <= maxSpread;
      record(
        "CV-9",
        "Spread",
        spreadOk,
        spreadOk
          ? null
          : `Spread too wide (${quoteSnapshot.spreadPct.toFixed(2)}%, max: ${maxSpread}%)`,
        { value: `${quoteSnapshot.spreadPct.toFixed(2)}%`, threshold: `${maxSpread}%` },
      );
    }

    // CV-10: Strategy compatibility
    if (input.sideBias) {
      const thesisDirection = structuredEvidence?.thesisDirection ?? "neutral";
      const contradicts =
        (input.sideBias === "long_only" && thesisDirection === "short") ||
        (input.sideBias === "short_only" && thesisDirection === "long");
      record(
        "CV-10",
        "Strategy compatibility",
        !contradicts,
        contradicts ? `Rationale contradicts ${input.sideBias} bias` : null,
        { value: thesisDirection, threshold: input.sideBias },
      );
    }

    const reasons = checks
      .filter((check) => !check.pass && check.detail != null)
      .map((check) => check.detail as string);

    return {
      allowed: reasons.length === 0,
      reasons,
      checks,
      evidence,
      quoteSnapshot,
    };
  }
}
