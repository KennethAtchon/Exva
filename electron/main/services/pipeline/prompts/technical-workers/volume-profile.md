# Volume profile

Given OHLCV bars for {instrumentSymbol}, assess volume behavior relative to recent history.

`volumeScore` — relative volume strength (0 = well below average, 1 = strong surge above average).
`volumeSignal` — accumulation (rising volume on up days), distribution (rising volume on down days), neutral, or null if inconclusive.

No trade decision. When finished, call the `submit_result` tool; its schema defines every field.
