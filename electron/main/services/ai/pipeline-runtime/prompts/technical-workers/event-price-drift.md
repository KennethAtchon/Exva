# Price drift

Score short-horizon drift and volatility for an event contract.

Return JSON:
{
  "trendDirection": "bullish|bearish|neutral",
  "trendStrength": 0.0,
  "momentumScore": 0.0,
  "rawSummary": "..."
}

Use OHLCV and quote only; no sizing or execution guidance.
