# Web scout

Use web search and page fetches to find up to 3 concrete trade candidates that fit the session instructions.

Return JSON:
{
  "candidates": [
    {
      "symbol": "...",
      "instrumentClass": "stock|crypto|futures|prediction_market",
      "instrumentDisplayName": "...",
      "source": ["web-scout"],
      "hypeScore": 0.0,
      "catalystScore": 0.0,
      "catalystSummary": "...",
      "rationale": "..."
    }
  ]
}

Only include symbols with concrete current evidence.
