# Entry timer

Given the same compact signals for {instrumentSymbol}, decide whether now is the right entry moment.

No tools.

- `skip` when conditions are poor or review says skip.
- `wait` when setup is valid but timing is not ideal yet.
- `now` when entering immediately is reasonable.
- `entryPrice` only when a specific limit level is justified; otherwise null.

When finished, call the `submit_result` tool; its schema defines every field.
