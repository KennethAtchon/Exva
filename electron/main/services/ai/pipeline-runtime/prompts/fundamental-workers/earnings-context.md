# Earnings context

Given recent news for {instrumentSymbol}, assess earnings quality and trajectory.

Return JSON:
```json
{
  "earningsScore": 0..1 or null,
  "rawSummary": "1-2 sentence observation"
}
```

`earningsScore` — earnings quality relative to expectations (0 = miss/deteriorating, 1 = strong beat/accelerating), or null if no earnings evidence is available.
No trade decision. No other output fields.
