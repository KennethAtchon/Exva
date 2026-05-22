export const MOCK_SCENARIO_KINDS = [
  "clean_breakout",
  "failed_breakout",
  "sideways_chop",
  "gap_down_after_entry",
  "news_reversal",
  "stale_quote",
  "wide_spread",
  "partial_fill",
  "broker_reject",
  "rate_limit",
] as const;

export type MockScenarioKind = (typeof MOCK_SCENARIO_KINDS)[number];

export const DEFAULT_MOCK_SCENARIO_KIND: MockScenarioKind = "clean_breakout";

export function isMockScenarioKind(value: string): value is MockScenarioKind {
  return (MOCK_SCENARIO_KINDS as readonly string[]).includes(value);
}

export const MOCK_SCENARIO_LABELS: Record<
  MockScenarioKind,
  { label: string; outcome: string }
> = {
  clean_breakout: {
    label: "Clean breakout (happy path)",
    outcome: "→ open trade",
  },
  failed_breakout: {
    label: "Failed breakout",
    outcome: "→ stop loss",
  },
  sideways_chop: { label: "Sideways chop", outcome: "→ skip" },
  gap_down_after_entry: {
    label: "Gap down after entry",
    outcome: "→ gap stop",
  },
  news_reversal: {
    label: "News reversal",
    outcome: "→ review skip",
  },
  stale_quote: { label: "Stale quote", outcome: "→ policy reject" },
  wide_spread: { label: "Wide spread", outcome: "→ policy reject" },
  partial_fill: { label: "Partial fill", outcome: "→ reduced size" },
  broker_reject: { label: "Broker reject", outcome: "→ order rejected" },
  rate_limit: { label: "Rate limit", outcome: "→ retry / reject" },
};
