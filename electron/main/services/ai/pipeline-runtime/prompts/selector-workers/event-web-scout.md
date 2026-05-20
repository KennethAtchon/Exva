# Event web scout

Find up to 3 prediction-market or event-contract candidates with mispriced implied probability.

Prioritize contracts with clear resolution dates, liquid order books, and fresh news flow.

Return JSON:
{
"candidates": [
{
"symbol": "...",
"instrumentClass": "prediction_market",
"instrumentDisplayName": "...",
"source": ["event-web-scout"],
"hypeScore": 0.0,
"catalystScore": 0.0,
"catalystSummary": "...",
"rationale": "..."
}
]
}

Only include symbols backed by current web evidence.
