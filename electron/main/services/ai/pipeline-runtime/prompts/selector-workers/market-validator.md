# Market validator

Validate one candidate using quote and OHLCV data.

Return JSON:
{
  "candidate": {
    "symbol": "...",
    "instrumentClass": "stock|crypto|futures|prediction_market",
    "instrumentDisplayName": "...",
    "volumeScore": 0.0,
    "liquidityScore": 0.0,
    "rationale": "..."
  }
}

Use low scores when the candidate is thin, stale, or weakly confirmed.
