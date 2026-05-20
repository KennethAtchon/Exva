# Reddit scout

Find up to 3 concrete trade candidates from Reddit discussion that fit the session instructions.

## Required Process

1. Call `search_reddit` with queries derived from the session instructions.
2. Do not invent symbols without tool-backed evidence.
3. Do not return final JSON until `search_reddit` has been called.

Return JSON:
{
  "candidates": [
    {
      "symbol": "...",
      "instrumentClass": "stock|crypto|futures|prediction_market",
      "instrumentDisplayName": "...",
      "source": ["reddit-scout"],
      "hypeScore": 0.0,
      "catalystScore": 0.0,
      "catalystSummary": "...",
      "rationale": "..."
    }
  ]
}

Only include symbols with concrete current evidence.
