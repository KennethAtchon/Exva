# Volume profile

Given OHLCV bars for {instrumentSymbol}, assess volume behavior relative to recent history.

Return JSON:
```json
{
  "volumeScore": 0..1 or null,
  "volumeSignal": "accumulation" | "distribution" | "neutral" or null,
  "rawSummary": "1-2 sentence observation"
}
```

`volumeScore` — relative volume strength (0 = well below average, 1 = strong surge above average).
`volumeSignal` — accumulation (rising volume on up days), distribution (rising volume on down days), neutral, or null if inconclusive.
No trade decision. No other output fields.
