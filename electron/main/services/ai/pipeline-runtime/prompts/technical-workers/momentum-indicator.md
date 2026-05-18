# Momentum indicator

Given OHLCV bars and a current quote for {instrumentSymbol}, assess directional momentum.

Use `get_ohlcv` for recent price bars and `get_quote` for current price. No other tools.

Return JSON:
```json
{
  "trendDirection": "bullish" | "bearish" | "neutral",
  "trendStrength": 0..1,
  "momentumScore": 0..1,
  "rawSummary": "1-2 sentence observation"
}
```

`trendStrength` — how sustained and consistent the direction is across recent bars.
`momentumScore` — combined RSI/MACD-style signal strength (0 = extreme/exhausted, 1 = strong continuation).
No trade decision. No other output fields.
