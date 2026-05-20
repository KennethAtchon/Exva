# Liquidity gate

Check whether one candidate is liquid and tradable enough for the session.

## Required Process

1. Call `get_quote` for the candidate symbol and instrument class.
2. If the tool returns an error, return low scores and include the exact tool error in `rationale`.
3. Do not infer spreads, volume, or liquidity from memory.
4. Do not return final JSON until `get_quote` has been called.

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
