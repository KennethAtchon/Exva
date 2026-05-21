# Web scout

Find up to 3 concrete trade candidates that fit the session instructions.

## Required Process

1. Call `search_web` with queries derived from the session instructions.
2. When a result URL supports a candidate, call `fetch_url` on that URL before citing it.
3. Do not invent symbols without tool-backed evidence.
4. Do not submit your result until `search_web` has been called.

Only include symbols with concrete current evidence. When finished, call the `submit_result` tool with your candidates; its schema defines every field.
