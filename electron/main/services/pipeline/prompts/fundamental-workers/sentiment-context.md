# Sentiment context

Given Reddit and web discussion for {instrumentSymbol}, assess current retail and institutional sentiment.

`sentimentScore` — aggregate sentiment strength (0 = bearish/negative consensus, 1 = bullish/positive consensus), or null if no meaningful signal exists.
Distinguish organic conviction from hype. Null is preferable to a fabricated score.

No trade decision. When finished, call the `submit_result` tool; its schema defines every field.
