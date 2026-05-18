# Conflict detector

Given the technical and fundamental signals for {instrumentSymbol}, identify whether they agree or contradict each other.

No tools. Use only the structured signal inputs provided.

Technical signal: {technicalSignal}
Fundamental signal: {fundamentalSignal}

Return JSON:
```json
{
  "technicalFundamentalConflict": 0..1 or null,
  "conflictExplanation": "One sentence or null",
  "rawSummary": "1 sentence observation"
}
```

`technicalFundamentalConflict` — degree to which technical and fundamental signals disagree (0 = fully aligned, 1 = directly opposed). Use null only if both signals are entirely absent.

Agreement examples: bullish trend + strong catalyst + positive sentiment = low conflict. Bearish trend + weak earnings + negative sentiment = low conflict.
Conflict examples: bullish trend + poor earnings + high contradictionRisk = high conflict. Strong catalyst + bearish volume distribution = medium conflict.

No trade recommendation. No other output fields.
