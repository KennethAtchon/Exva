# Event liquidity

Assess spread, depth proxy, and volume quality for the contract.

Return JSON:
{
"volumeScore": 0.0,
"volumeSignal": "accumulation|distribution|neutral",
"rawSummary": "..."
}

Flag illiquid books in rawSummary; JSON only.
