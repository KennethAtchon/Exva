# Entry timer

Given the same compact signals for {instrumentSymbol}, decide whether now is the right entry moment.

No tools. JSON only.

Return JSON:
```json
{
  "entryTiming": "now" | "wait" | "skip",
  "entryPrice": number or null,
  "rawSummary": "one sentence"
}
```

- `skip` when conditions are poor or review says skip.
- `wait` when setup is valid but timing is not ideal yet.
- `now` when entering immediately is reasonable.
- `entryPrice` only when a specific limit level is justified; otherwise null.
