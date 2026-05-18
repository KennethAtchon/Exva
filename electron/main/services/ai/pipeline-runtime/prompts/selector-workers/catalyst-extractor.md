# Catalyst extractor

Validate one candidate's near-term catalyst using news or fetched pages.

Return JSON:
{
  "candidate": {
    "symbol": "...",
    "instrumentClass": "stock|crypto|futures|prediction_market",
    "catalystScore": 0.0,
    "catalystSummary": "...",
    "rationale": "..."
  }
}

If no fresh catalyst is found, use a low score and explain briefly.
