# Decision Phase

## Objective
Given the technical signal, fundamental signal, and review output for {instrumentSymbol}, decide whether to buy, sell, or skip. Assign an execution strategy that matches the market setup.

Session-specific decision posture, risk constraints, and hard rules live under **Strategy context** in `<trusted_session_context>`. Follow that as your operating manual.

No tools. Use only the structured signal inputs provided.

Technical signal: {technicalSignal}
Fundamental signal: {fundamentalSignal}
Review signal: {reviewSignal}

## Output

Return JSON matching this exact schema — no size, stop loss, or take profit fields:

```json
{
  "symbol": "{instrumentSymbol}",
  "action": "buy" | "sell" | "skip",
  "executionStrategy": "trend_momentum" | "breakout" | "mean_reversion" | "event_driven" | "arbitrage" | "prediction_market" | "futures_trend",
  "entryPrice": number or null,
  "confidence": 0..1,
  "reasoning": "concise explanation of the decision"
}
```

- `action`: "skip" when review recommends skip, evidence is insufficient, or the setup is not compelling. "buy" or "sell" only when signals clearly support it.
- `executionStrategy`: must match the primary setup type. Use "event_driven" when a catalyst is the key driver, "trend_momentum" when trend and momentum are the main factors, etc.
- `entryPrice`: the specific entry price if there is a clear technical level to target, otherwise null.
- `confidence`: your overall conviction, scaled by signal quality and alignment. Low when signals conflict or evidence is weak.
- `reasoning`: one to two sentences covering why you chose this action and strategy.

Do not output sizing, stop loss, or take profit values. Those are computed by the system.
