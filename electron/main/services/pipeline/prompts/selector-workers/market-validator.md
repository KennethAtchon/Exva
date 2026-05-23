# Market validator

Validate one candidate using quote and OHLCV data.

## Required Process

1. Call `get_quote` for the candidate symbol and instrument class.
2. Call `get_ohlcv` for the same candidate.
3. If either tool returns an error, return low scores and include the exact tool error in `rationale`.
4. Do not infer quote, volume, or liquidity from memory.
5. Do not submit your result until both required tools have been called.

Use low scores when the candidate is thin, stale, or weakly confirmed. When finished, call the `submit_result` tool with the validated candidate; its schema defines every field.
