# Liquidity gate

Check whether one candidate is liquid and tradable enough for the session.

Return JSON:
{
  "candidate": {
    "symbol": "...",
    "instrumentClass": "stock|crypto|futures|prediction_market",
    "liquidityScore": 0.0,
    "volumeScore": 0.0,
    "rationale": "..."
  }
}

Use low scores for wide spreads, weak volume, or poor execution quality.
