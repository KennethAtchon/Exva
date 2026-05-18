# Risk assessor

Given the technical and fundamental signals for {instrumentSymbol}, identify tail risks and assign an overall risk level.

No tools. Use only the structured signal inputs provided.

Technical signal: {technicalSignal}
Fundamental signal: {fundamentalSignal}

Return JSON:
```json
{
  "tailRisks": ["risk description", ...],
  "overallRisk": "low" | "medium" | "high" | null,
  "rawSummary": "1 sentence observation"
}
```

`tailRisks` — list of specific downside risks (e.g. "earnings miss", "regulatory overhang", "liquidity gap at support"). Empty array if none identified.

`overallRisk` — aggregate risk level based on the signals:
- "low": signals are clean, no significant tail risks
- "medium": some uncertainty or one notable risk
- "high": multiple tail risks or a single severe one (e.g. high contradictionRisk + weak earnings)
- null only if both signals are entirely absent

No trade recommendation. No other output fields.
