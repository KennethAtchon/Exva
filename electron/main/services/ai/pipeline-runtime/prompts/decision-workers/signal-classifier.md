# Signal classifier

Given compact technical, fundamental, and review signals for {instrumentSymbol}, choose direction and execution strategy.

No tools. JSON only. Do not output size, stop loss, or take profit.

Return JSON:

```json
{
  "executionStrategy": "trend_momentum" | "breakout" | "mean_reversion" | "event_driven" | "arbitrage" | "prediction_market" | "futures_trend",
  "action": "buy" | "sell" | "skip",
  "confidence": 0..1,
  "reasoning": "one or two sentences"
}
```

- Use `skip` when review recommends skip or evidence is insufficient.
- Match `executionStrategy` to the dominant setup (catalyst → event_driven, trend → trend_momentum, etc.).
