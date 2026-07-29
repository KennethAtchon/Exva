# Solution 07 - AI Reliability, Fallback, and Spend Governance

> **Outcome:** A provider outage or a malformed model response degrades one cycle into a typed skip
> instead of killing a session, and no candidate consumes expensive AI work before cheap deterministic
> gates have accepted it.
> **Relationship to Solution 02:** Solution 02 Workstream 6 fixes the **schema boundary** (repair once,
> then typed skip). This document fixes the **provider layer** above it and the **spend ordering**
> around it.

Implements: docs/engineering/CODING_GUIDELINES.md

## Verified Current Behavior

`electron/main/services/llm/runtime-retry.ts`:

```ts
const RETRY_CONFIG: RetryConfig = {
  timeoutMs: 60_000,
  backoffMs: [1_000, 2_000, 4_000, 8_000],
  maxRetries: 4,
};
```

What exists: bounded retry, exponential backoff, per-attempt logging with provider/model/worker/session
context.

What does not exist:

1. **No cross-provider or cross-model fallback.** `grep -rIn "fallback" electron/main/services/llm/`
   returns exactly one hit, a comment in `model-pricing.ts` about price-table lookups. Five failed
   attempts against one provider means the phase fails; there is no second route.
2. **No circuit breaker.** Every worker in every session retries the same failing provider for up to
   five attempts and five minutes. The July 27 run recorded 146 attempt failures and a 67% error rate
   in one 15-minute window while continuing to route every call to the same place.
3. **No pre-spend budget gate.** Cost is recorded after the fact (`resolve-run-cost.ts`, the cost
   breakdown panel). Nothing stops a cycle from spending on a candidate that a later stage will
   certainly reject.

Persisted July 27 failure distribution — 78 of 260 execution steps (30%):

| Stage       | Error                                       | Count | Layer                 |
| ----------- | ------------------------------------------- | ----: | --------------------- |
| Fundamental | Required `pHat` missing                     |    62 | Schema (Sol. 02 WS6)  |
| Fundamental | Provider failed after five timeout attempts |     8 | Provider (this doc)   |
| Review      | `rawSummary` destructured from undefined    |     6 | Null safety (Sol. 02) |
| Fundamental | Required decision fields all missing        |     2 | Schema (Sol. 02 WS6)  |

## Workstream 1: Provider Health and Circuit Breaking

Add a provider health tracker keyed by `(providerType, modelId)`.

```ts
interface ProviderHealth {
  key: string;
  windowStart: string;
  attempts: number;
  failures: number;
  consecutiveFailures: number;
  state: "closed" | "half_open" | "open";
  openedAt: string | null;
  lastError: { code: string; message: string } | null;
}
```

Transitions:

- `closed -> open` when the rolling 10-minute failure rate exceeds 50% over at least six attempts, or
  on four consecutive timeout exhaustions.
- `open -> half_open` after 5 minutes; a single probe call decides.
- `half_open -> closed` on probe success; `half_open -> open` on probe failure with a doubled cooldown,
  capped at 30 minutes.

While a route is `open`, calls do not queue behind it — they route to the fallback chain or terminate
as a typed `provider_unavailable` skip. The state is visible in the session funnel and in the existing
cost/observability surfaces, with the failure **denominator** shown; "8 failures" is meaningless
without "of how many calls."

## Workstream 2: Ordered Fallback Routes

Each worker role resolves an ordered route list rather than one provider.

```ts
interface WorkerRoute {
  role: string;
  routes: Array<{
    providerType: string;
    modelId: string;
    purpose: "primary" | "fallback" | "repair";
  }>;
}
```

Rules:

- Fallback is attempted on transport failure, timeout exhaustion, and structured-output invalidity
  after the single bounded repair from Solution 02 Workstream 6 — not on a legitimate model refusal or
  a valid response the caller dislikes.
- At most one fallback hop per cycle. Two providers failing is a cycle failure, not a third attempt.
- Structured-output-heavy roles (forecast, decision) prefer a model with native structured output.
  Roles that failed 62 times on a required probability field are exactly the roles that should not run
  on the least reliable route.
- Every attempt persists provider, model, purpose, latency, outcome, and cost so the route decision is
  auditable per cycle.

**User decision (U3/U5).** OpenRouter is a router: its failure modes include upstream provider
variance that Exva cannot see. A direct first-party key (Anthropic or OpenAI) as the **primary** route
for structured-output roles, with OpenRouter retained as the fallback and for breadth, is the
recommended configuration. This is a settings change once the route contract exists; it is not a code
blocker and it does not fix the schema handling, which must be fixed regardless.

## Workstream 3: Spend Ordering

Generalize the rule that Solution 02 applies to EDGAR: **deterministic rejection always precedes paid
work.**

Ordering contract for every AI-backed pipeline:

```text
1. Identity resolution        (free, local)
2. Broker/asset tradability   (cached broker metadata)
3. Liquidity and price floors (stored bars/quotes)
4. Freshness/staleness        (timestamps)
5. Duplicate/cooldown checks  (local state)
--- spend boundary ---
6. Research workers
7. Review / adversarial stage
8. Decision
```

No stage above the boundary may call a provider. Any new pipeline stage that wants AI must declare
which deterministic gates precede it; a stage with no declared predecessors fails review.

July 27 demonstrates the cost of the current order: OYCG, GRUSF, and PEBO each consumed research spend
(`ai_cost_usd` 0.0058–0.0064 per trade row) before the adversarial stage correctly rejected them for
staleness and illiquidity — facts that were all knowable for free, before the first token.

## Workstream 4: Budget Governance

Add enforced caps, evaluated before the spend boundary:

| Scope             | Default  | On breach                                               |
| ----------------- | -------- | ------------------------------------------------------- |
| Per cycle         | `$0.25`  | Terminate cycle as `budget_exceeded`, persist partials  |
| Per session/day   | `$5.00`  | Session stops accepting new candidates; existing finish |
| Per workspace/day | `$25.00` | Global AI pause with an operator banner                 |

Caps are configurable and default conservative. A breach is a typed terminal outcome with the spend to
date, never a silent stop. Report cost per **accepted** candidate, not only total cost — the July 27
number that matters is that AI spend produced zero accepted candidates.

## Workstream 5: Failure Classification

Every AI failure persists a stable code so the funnel can count it:

```text
provider_timeout
provider_unavailable      (circuit open)
provider_rate_limited
model_output_invalid      (after bounded repair)
model_refused
budget_exceeded
tool_loop_exceeded
```

No AI failure may surface as an untyped exception or a null cycle outcome. `attention_required` fires
on the thresholds in Solution 05, evaluated against a real denominator.

## Tests

### Unit

- Circuit opens on the documented failure-rate and consecutive-failure thresholds and not before.
- `half_open` probe success closes; probe failure doubles the cooldown up to the cap.
- Fallback fires on timeout exhaustion and post-repair invalidity; does not fire on a valid response.
- At most one fallback hop per cycle.
- Cycle, session, and workspace budget breaches each produce their documented terminal outcome.
- Every failure class maps to a stable code.

### Composition

Run a real pipeline cycle with a faked provider that: (a) times out five times, (b) returns malformed
JSON, (c) succeeds on the fallback route. Assert one repair attempt, one fallback hop, correct persisted
attempt records, and a typed outcome in every branch.

### Spend Ordering

A fixture candidate that fails the liquidity floor must produce **zero** provider calls. Assert on the
API call log, not on the final decision.

## Acceptance Criteria

- [ ] A failing provider opens a circuit instead of being retried by every worker.
- [ ] Structured-output roles have a declared fallback route and use it at most once per cycle.
- [ ] No provider call occurs for a candidate that a deterministic gate rejects.
- [ ] Cycle, session, and workspace AI budgets are enforced before spend, not reported after.
- [ ] Every AI failure has a stable code and appears in the session funnel with its denominator.
- [ ] Cost per accepted candidate is reported alongside total cost.
- [ ] One full paper day produces zero untyped AI exceptions.
