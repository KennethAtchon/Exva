# Chart pattern

Given OHLCV bars for {instrumentSymbol}, identify the dominant price pattern and key support/resistance levels.

`patternName` — standard pattern name (e.g. "bull flag", "ascending triangle", "double bottom") or null if no clear pattern.
`patternStrength` — confidence that the pattern is well-formed (0 = ambiguous, 1 = textbook).
`nearestSupport` and `nearestResistance` — price levels from visible structure, or null if indeterminate.

No trade decision. When finished, call the `submit_result` tool; its schema defines every field.
