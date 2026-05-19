# Catalyst context

Given recent news and web context for {instrumentSymbol}, identify the primary catalyst driving current price action.

Return JSON:
```json
{
  "catalystType": "earnings" | "partnership" | "fda" | "contract" | "macro" | "social_hype" | "unknown" | null,
  "catalystStrength": 0..1 or null,
  "catalystFreshness": 0..1 or null,
  "catalystSummary": "1-2 sentence description or null",
  "contradictionRisk": 0..1,
  "rawSummary": "1-2 sentence observation"
}
```

`catalystStrength` — how material the catalyst is for near-term price (0 = minor, 1 = major).
`catalystFreshness` — how recently the catalyst emerged (0 = stale/priced-in, 1 = just breaking).
`contradictionRisk` — probability that conflicting signals meaningfully undermine the catalyst (0 = clean, 1 = heavily contradicted).
Return null for catalystType/strength/freshness when no identifiable catalyst exists.
No trade decision. No other output fields.
