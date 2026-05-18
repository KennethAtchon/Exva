# Chart pattern

Given OHLCV bars for {instrumentSymbol}, identify the dominant price pattern and key support/resistance levels.

Use `get_ohlcv` for recent bars. No other tools.

Return JSON:
```json
{
  "patternName": "string or null",
  "patternStrength": 0..1 or null,
  "nearestSupport": price or null,
  "nearestResistance": price or null,
  "rawSummary": "1-2 sentence observation"
}
```

`patternName` — standard pattern name (e.g. "bull flag", "ascending triangle", "double bottom") or null if no clear pattern.
`patternStrength` — confidence that the pattern is well-formed (0 = ambiguous, 1 = textbook).
`nearestSupport` and `nearestResistance` — price levels from visible structure, or null if indeterminate.
No trade decision. No other output fields.
