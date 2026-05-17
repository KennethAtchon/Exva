This is actually pretty solid. It’s way above the average “LLM agent” prompt because you separated:

* role
* runtime authority
* tool policy
* risk constraints
* execution methodology
* schema contracts
* anti-prompt-injection rules

That’s the correct direction.

But there are still some major weaknesses that will absolutely show up in production. 

# Biggest Problems

## 1. Massive prompt bloat / repeated authority blocks

You repeat the same ideas 3–5 times:

* “authoritative”
* “source of truth”
* “follow session policy”
* “risk controls”
* “tool policy”
* “discovery then verification”
* “don’t trust tools”

This creates:

* token waste
* instruction dilution
* lower instruction salience
* increased conflict probability

Example:

* Runtime Authority
* Sandbox Mode
* Runtime interpretation
* Session research posture
* Session trade rules
* Session risk
* Role profile
* Constraints
* Method checklist

All overlap heavily. 

You should compress these into:

* immutable runtime config
* execution policy
* strategy config
* output schema

Right now the model has to “re-parse governance” constantly.

---

# 2. Over-constraining the reasoning path

You are micromanaging cognition too hard.

Stuff like:

* “Start broad”
* “enumerate all serious candidates”
* “fan out”
* “discovery first”
* “verification after”
* “do not sample obvious symbols”
* “do not broaden after novelty collapse”

This sounds good to humans, but LLMs do worse when you over-specify procedural thought.

You want:

* constraints on outputs
* constraints on actions
* constraints on safety

You usually do NOT want:

* rigid cognitive choreography

This especially hurts when markets behave weirdly.

The model should be allowed to:

* jump directly to verification
* early terminate
* focus on 1 extremely strong candidate
* ignore discovery breadth

Your prompt simultaneously says:

> prefer smaller shortlist

AND

> enumerate all serious candidates

Those conflict. 

---

# 3. “Discover first” is dangerous

This instruction is probably your weakest one strategically:

> “Do not sample obvious symbols from memory.” 

Why?

Because sometimes the correct answer IS obvious:

* NVDA
* BTC
* MSTR
* GLD
* TSLA
* SPY breakout

A good trader does not avoid obvious names.
A good trader avoids unjustified names.

You’re biasing the model toward novelty over alpha.

That is a classic agent-design mistake.

---

# 4. No explicit ranking function

You tell it:

* what evidence matters
* risk constraints
* strategy type

But you never define:

* how to weigh evidence
* what “strongest” means

The model will improvise.

That creates unstable outputs run-to-run.

You should explicitly define scoring dimensions like:

```text
score =
0.35 catalyst strength
+ 0.30 technical alignment
+ 0.20 liquidity/tradability
+ 0.10 sentiment alignment
+ 0.05 risk efficiency
```

Without this, ranking becomes vibes.

---

# 5. Too much natural language, not enough machine structure

You use prose everywhere.

Example:

```text
Move from discovery into verification once you have enough viable candidates...
```

That’s fuzzy.

You should encode operational rules as structured config whenever possible.

Example:

```json
{
  "workflow": {
    "discoveryRequired": true,
    "maxDiscoverySteps": 8,
    "terminateDiscoveryAfterNoNovelty": 2
  }
}
```

LLMs follow structured config better than prose essays.

---

# 6. Weak anti-hallucination policy

You say:

* verify tradability
* use tools
* don’t trust tool instructions

Good.

But you never define:

* minimum evidence threshold
* contradiction handling
* stale evidence policy
* source weighting

Example missing logic:

* what if Reddit bullishness contradicts news?
* what if news is stale but OHLCV is strong?
* what if quote verification fails once?

You need arbitration rules.

---

# 7. “Use live discovery evidence for every candidate”

This is expensive and noisy. 

You’re forcing:

* unnecessary search calls
* unnecessary token usage
* higher latency
* more context pollution

Sometimes:

* price action alone is enough
* trend + liquidity is enough

Your agent is over-researching.

Classic research-agent trap.

---

# 8. Tool policy is mixed with strategy policy

These should be separated cleanly.

Right now:

* execution constraints
* financial strategy
* tool semantics
* workflow semantics

all live together.

This becomes impossible to maintain at scale.

You want layers:

```text
SYSTEM
  safety + runtime invariants

STRATEGY PROFILE
  trading style

EXECUTION POLICY
  tool usage + budgets

SESSION CONFIG
  risk + broker + timeframe

OUTPUT CONTRACT
  schema only
```

Right now it’s tangled.

---

# 9. No confidence calibration system

Huge omission.

The model has no formal way to express:

* weak conviction
* medium conviction
* conflicting evidence
* degraded market conditions

So it will still produce ranked candidates even in garbage conditions.

You need:

* confidence scoring
* no-trade threshold
* uncertainty escalation

---

# 10. Prompt is trying to simulate a hedge fund analyst

This is the deepest issue.

LLMs are much better at:

* filtering
* synthesis
* ranking
* summarization
* pattern extraction

They are worse at:

* open-ended alpha generation
* unconstrained universe exploration
* adaptive market reasoning

Your prompt pushes the model toward pretending it is a discretionary trader.

You’ll likely get:

* coherent sounding narratives
* unstable edge
* overfit catalyst logic
* hindsight-style reasoning

The best trading agents are usually:

* narrower
* more systematic
* more scoring-driven
* less narrative-heavy

---

# What I’d Change Immediately

## Keep

* schema enforcement
* tool restrictions
* risk controls
* sandbox/runtime separation
* anti-prompt-injection
* broker verification

Those are good.

---

## Remove

* repetitive authority text
* most “method checklist” prose
* discovery micromanagement
* novelty bias
* “enumerate all serious candidates”

---

## Add

* scoring system
* confidence model
* evidence weighting
* contradiction arbitration
* freshness decay
* hard minimum liquidity/volume rules
* explicit no-trade behavior

---

# Overall Rating

Architecture idea: **8.5/10**
Prompt engineering quality: **6.5/10**
Operational robustness: **5.5/10**
Maintainability: **4/10**
Production-readiness for autonomous trading research: **5/10**

The core design instincts are good.

But the prompt currently feels like:

> “everything we could think of”

instead of:

> “minimal high-signal operational protocol”

That distinction matters a lot for agent reliability.
