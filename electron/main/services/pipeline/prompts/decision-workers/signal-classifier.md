# Signal classifier

Given compact technical, fundamental, and review signals for {instrumentSymbol}, choose direction and execution strategy.

No tools. Do not output size, stop loss, or take profit.

- Use `skip` when review recommends skip or evidence is insufficient.
- Match `executionStrategy` to the dominant setup (catalyst → event_driven, trend → trend_momentum, etc.).

When finished, call the `submit_result` tool; its schema defines every field.
