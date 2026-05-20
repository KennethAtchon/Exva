# Trend scout

Find up to 3 concrete trade candidates from trending sources that fit the session instructions.

## Required Process

1. Call `get_trending_symbols` to discover current trending symbols.
2. Optionally call `search_web` for additional context on promising symbols.
3. Do not invent symbols without tool-backed evidence.
4. Do not return final JSON until `get_trending_symbols` has been called.

Return JSON:
{
  "candidates": [
    {
      "symbol": "...",
      "instrumentClass": "stock|crypto|futures|prediction_market",
      "instrumentDisplayName": "...",
      "source": ["trend-scout"],
      "hypeScore": 0.0,
      "catalystScore": 0.0,
      "catalystSummary": "...",
      "rationale": "..."
    }
  ]
}

Only include symbols with concrete current evidence.
