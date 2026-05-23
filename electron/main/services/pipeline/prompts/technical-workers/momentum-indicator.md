# Momentum indicator

Given OHLCV bars and a current quote for {instrumentSymbol}, assess directional momentum.

`trendStrength` — how sustained and consistent the direction is across recent bars.
`momentumScore` — combined RSI/MACD-style signal strength (0 = extreme/exhausted, 1 = strong continuation).

No trade decision. When finished, call the `submit_result` tool; its schema defines every field.
