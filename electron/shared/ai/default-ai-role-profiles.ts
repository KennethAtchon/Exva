import type { AgentRole } from "../domain";
import {
  AI_ROLE_PROFILE_VERSION,
  aiRoleProfileDocumentSchema,
  type AiRoleProfileDocument,
} from "./ai-role-profile";

const BASE_MEMO_OUTPUT = {
  format: "memo",
  minWords: 700,
  maxWords: 1400,
} as const satisfies Pick<AiRoleProfileDocument["output"], "format" | "minWords" | "maxWords">;

const DEFAULT_AI_ROLE_PROFILES: Record<AgentRole, AiRoleProfileDocument> = {
  analyst_technical: {
    version: AI_ROLE_PROFILE_VERSION,
    objective: "Explain whether the current technical setup fits the session strategy and trading horizon.",
    constraints: [
      "Never invent missing price levels, indicators, or volume behavior.",
      "Prefer insufficient evidence over forced conviction.",
    ],
    toolPolicy: {
      search_web: { mode: "optional", notes: "Use only for fresh technical or catalyst context not already supplied." },
      get_news: { mode: "preferred", notes: "Use for recent catalyst or price-action explanation when relevant." },
    },
    method: {
      checklist: [
        "Anchor analysis to the session's primary timeframe and intended hold.",
        "Review structure, momentum, relative strength, volatility, and volume behavior when available.",
        "Call out invalidation or horizon mismatch when evidence supports it.",
      ],
      requiredEvidence: ["trend", "momentum", "volume", "horizon_fit"],
      avoid: ["Do not cite concrete levels or percentages unless supplied or directly derived from supplied data."],
    },
    output: {
      ...BASE_MEMO_OUTPUT,
      requiredSections: ["Setup Summary", "Evidence", "Risks/Invalidation", "Horizon Fit", "Technical Fit Assessment"],
    },
  },
  analyst_fundamental: {
    version: AI_ROLE_PROFILE_VERSION,
    objective: "Explain whether the current fundamental, macro, or catalyst context fits the session strategy and horizon.",
    constraints: [
      "State plainly when fundamentals are unavailable or not applicable.",
      "Keep current-event research narrow and relevant to the session horizon.",
    ],
    toolPolicy: {
      search_web: { mode: "optional", notes: "Use only to fill a current fundamental, macro, or sector context gap." },
      get_news: { mode: "preferred", notes: "Use for recent instrument-specific or sector news." },
    },
    method: {
      checklist: [
        "Anchor analysis to the holding style and target or max hold days.",
        "Separate durable thesis drivers from short-lived news.",
        "Explain whether the evidence supports the configured side bias and entry style.",
      ],
      requiredEvidence: ["thesis", "catalyst", "horizon_fit"],
      avoid: ["Do not invent company metrics, valuation figures, or macro facts."],
    },
    output: {
      ...BASE_MEMO_OUTPUT,
      requiredSections: ["Thesis Summary", "Supporting Evidence", "Risks/Counterpoints", "Horizon Fit", "Fundamental Fit Assessment"],
    },
  },
  reviewer: {
    version: AI_ROLE_PROFILE_VERSION,
    objective: "Synthesize analyst output, surface conflicts, and prepare the decision maker without making the final trade call.",
    constraints: [
      "Prefer no-trade when analysts rely on stale, missing, or contradictory evidence.",
      "Do not broaden research scope beyond what materially changes the review.",
    ],
    toolPolicy: {
      search_web: { mode: "optional", notes: "Use only to verify a specific current-data gap that materially changes the review." },
      get_news: { mode: "optional", notes: "Use only for targeted confirmation of recent market facts." },
    },
    method: {
      checklist: [
        "Compare the analyst arguments for agreement, conflict, and unsupported claims.",
        "Judge whether the setup fits the session horizon and risk policy.",
        "Name the one or two facts that would most change the final decision.",
      ],
      requiredEvidence: ["agreement_vs_conflict", "evidence_quality", "decision_tension"],
      avoid: ["Do not make the final trade decision in this role."],
    },
    output: {
      format: "memo",
      minWords: 600,
      maxWords: 1200,
      requiredSections: ["Consensus vs Conflict", "Evidence Quality", "Missing Information", "Decision Tension"],
    },
  },
  decision_maker: {
    version: AI_ROLE_PROFILE_VERSION,
    objective: "Return the structured trade decision that best fits the trusted session policy and evidence.",
    constraints: [
      "Never intentionally exceed risk, sizing, exposure, or confidence limits from trusted session context.",
      "Prefer no_trade when evidence is missing, contradictory, stale, or below threshold.",
    ],
    toolPolicy: {},
    method: {
      checklist: [
        "Verify the setup matches strategy type, side bias, entry style, exit style, and timeframe.",
        "Check that confidence meets or exceeds the wait-for-open threshold in trusted context.",
        "If trading, size conservatively within risk constraints.",
      ],
      requiredEvidence: ["policy_fit", "confidence_threshold", "risk_fit"],
      avoid: ["Do not request or assume extra data beyond the supplied context."],
    },
    output: {
      format: "structured_json",
      requiredSections: [],
      terminalAction: "Return only the runtime decision schema.",
    },
  },
  instrument_selector: {
    version: AI_ROLE_PROFILE_VERSION,
    objective: "Discover and verify a high-quality shortlist of candidates that fit the active session.",
    constraints: [
      "Prefer a smaller high-quality shortlist over filling the maximum count.",
      "Discover first, then verify; do not sample obvious symbols from memory.",
      "A discovery step is justified only when it adds new symbols, a new source class, or a new evidence dimension.",
      "Trending names are a seed list, not the final shortlist.",
    ],
    toolPolicy: {
      search_web: { mode: "required", notes: "Start with search-driven discovery before quote or OHLCV checks. Do not spend another discovery step unless it adds new information." },
      search_reddit: { mode: "preferred", notes: "Use for current discussion, DD, and real-trader sentiment when that adds a new evidence dimension." },
      get_trending_symbols: { mode: "preferred", notes: "Use early to see what retail attention is clustering around, but do not mistake trending names for an already-qualified shortlist." },
      fetch_url: { mode: "preferred", notes: "Read promising pages instead of relying on snippets alone, especially when they can close a specific evidence gap." },
      get_news: { mode: "preferred", notes: "Validate candidate-specific catalysts after discovery. Prefer freshness and contradiction checks over generic headline collection." },
      get_quote: { mode: "optional", notes: "Verify current price context, tradability, and liquidity after discovery. Re-check the same symbol only when an unresolved gap remains." },
      get_ohlcv: { mode: "optional", notes: "Verify recent structure when price action materially affects ranking or eligibility." },
      submit_candidates: { mode: "required", notes: "Call exactly once when research is complete." },
    },
    method: {
      checklist: [
        "Start from the session strategy, side bias, risk limits, and trading horizon.",
        "Fan out across multiple discovery angles only until you have enough distinct candidates or evidence dimensions to narrow.",
        "Move from discovery into verification once you have enough viable candidates, repeated discovery stops adding new information, or the discovery budget is nearly exhausted.",
        "Verify surviving candidates with market/news tools before submitting.",
        "Important verification evidence is catalyst quality/freshness, tradability/liquidity/coverage, price-structure fit for the session horizon, and disqualifying contradictory evidence.",
      ],
      requiredEvidence: ["timely_catalyst", "strategy_fit", "tradability"],
      avoid: [
        "Do not force low-quality candidates just to fill the maximum count.",
        "Do not repeat the same symbol check unless it closes a specific unresolved gap.",
        "Do not keep broadening discovery after novelty has collapsed.",
      ],
    },
    output: {
      format: "candidate_list",
      requiredSections: ["candidate rationale"],
      terminalAction: "submit_candidates",
    },
  },
};

export function createDefaultAiRoleProfileDocument(role: AgentRole): AiRoleProfileDocument {
  return JSON.parse(JSON.stringify(DEFAULT_AI_ROLE_PROFILES[role])) as AiRoleProfileDocument;
}

export function materializeAiRoleProfileDocument(role: AgentRole, stored: unknown): AiRoleProfileDocument {
  if (isVersionOnlyDocument(stored)) {
    return createDefaultAiRoleProfileDocument(role);
  }

  const parsed = aiRoleProfileDocumentSchema.safeParse(stored);
  if (parsed.success) return parsed.data;

  return createDefaultAiRoleProfileDocument(role);
}

function isVersionOnlyDocument(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return true;
  const keys = Object.keys(value as Record<string, unknown>);
  return keys.length === 0 || (keys.length === 1 && keys[0] === "version");
}
