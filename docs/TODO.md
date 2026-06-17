Flaw in the system:

An experience like "GC/CL 4h trend following" has signal sources of:

SPY 15m mean reversion (rules)
Listener

Timer

QQQ 15m mean reversion (rules)
Listener

Timer

BTC-USD 1h momentum breakout (rules)
Listener

Timer

GC/CL 4h trend following (rules)
Listener

Timer

This is very confusing UX/UI and terrible UX/UI at that. EIther:

Generalize experience or make 1 experience for 1 signal (which doesnt make sense).
What I want is for a experience to have many signals and u can toggle them all on at the same time. So this needs to be generalize from:

{Very specific Experience} -> {General Experience Grouped by a common thing}

SPY 15M mean reversion -> Does this mean we do mean reversion on SPY every 15 minutes and if it meets our criteria, we enter? This should NOT be an experience, it SHOULD be a signal. The way we have approach "experiences" is all wrong, we have the WRONG MENTAL MODEL for it. A experience should be a TENT. not a very specific thing - because what the fuck do we need a signal source then if the experience IS the thing.

How do we tell SPY 15M apart? like is 15m the time between or is it the timeframe? We define timeframe in the session strategies, but we need to define them for signals too. There can be alot of overlap with strategies and signals. Strategies are meant to be used with AI based trading and I believe some of these signals are "truly autonomous and deterministic" without requiring agents, our docs need to clearly convey the experience AND if the pipeline contains AI or its auto. There are so many other LOGICAL bugs with the codebase, can you help me discover and write a SPEC to implement this, write the spec to: /Users/ken/Documents/workspace/Exva/docs/specs.
