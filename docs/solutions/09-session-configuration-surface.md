# Solution 09 - Session Configuration Surface

> **Outcome:** Configuring a session cannot silently produce a lane that has no template, no valid
> instruments, or no history — and a backend failure during configuration is visible instead of looking
> like an empty catalog.
> **Problem addressed:** `P2-4` — session input editor contracts are inconsistent and swallow failures.

Implements: docs/engineering/CODING_GUIDELINES.md

## Verified Current Behavior

`src/components/sessions/SessionInputEditor.tsx` loads two things and handles their failures
differently.

Template catalog load (line ~377):

```tsx
void experienceCatalogApi
  .listTemplates()
  .then(({ templates }) => {
    dispatch({ templates, templatesLoaded: true });
  })
  .catch(() => {
    if (cancelled) return;
    dispatch({ templates: [], templatesLoaded: true }); // failure === empty catalog
  });
```

Configuration options load (line ~421):

```tsx
.catch((err) => {
  dispatch({
    options: null,
    optionsLoaded: true,
    optionsError: err instanceof Error ? err.message : "Failed to load configuration options.",
  });
});
```

Two defects:

1. **The template catalog failure is erased.** An IPC error, a repository throw, or a schema mismatch
   renders identically to "there are no templates." The component's own state carries a
   `templateError: string | null` field that is declared and never assigned.
2. **Two loaders in one component use two different contracts.** One reports errors, one does not.
   There is no shared shape for `loading | loaded | error`, so correctness depends on whoever wrote
   each `.catch`.

This is exactly the class of defect that made the July 27 diagnosis slow: a failure that presents as a
benign empty state. The operator sees "no templates available," concludes the catalog is empty, and
never learns that the call failed.

## Workstream 1: One Async Load Contract

Define a single shared shape and use it for every renderer-side load in the session surfaces.

```ts
type AsyncResource<T> =
  | { status: "loading" }
  | { status: "loaded"; value: T }
  | { status: "error"; message: string; retryable: boolean };
```

Rules:

- No `.catch` in a session-configuration component may discard the error.
- An empty successful result and a failed load must render differently. "No templates match this
  filter" and "Could not load templates" are different sentences and different affordances.
- Every error state offers a retry when the failure is retryable.
- Save/continue is disabled while any required resource is in `error`. The current code allows the user
  to proceed from a failed catalog load as though the choice set were legitimately empty.

## Workstream 2: Configuration-Time Validation

The editor currently permits combinations that are guaranteed to produce zero evaluations. Validate at
configuration time and explain, rather than allowing a silent dead lane.

| Check                   | Rule                                                                        | On failure                                            |
| ----------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------- |
| Producer reachability   | The selected experience has a producer that can emit for the selected input | Block with the reason (see Solution 02 WS4)           |
| Class compatibility     | Instrument classes match what the strategy and broker route support         | Block, naming the offending symbols                   |
| Timeframe compatibility | The timeframe is supported by the strategy and the data provider            | Block                                                 |
| History sufficiency     | Stored bars meet `minEvaluableBars`, or provisioning can reach it           | Warn with the counts and offer to provision (Sol. 06) |
| Broker route            | An assigned, certified paper account exists for every selected class        | Block                                                 |
| Schedule duplication    | Another session shares the identical schedule group and inputs              | Warn — this is the `ETF-REVERSION-CONTENDER` case     |

Blocking checks prevent creation. Warnings are shown on the session card afterward, not only in the
modal, so a session that degrades after creation still surfaces the problem.

## Workstream 3: Typed IPC End to End

Every channel used by the configuration surface returns a shared Zod-validated schema. The preload must
not widen results to `unknown`, and the renderer must not re-parse ad hoc. A schema mismatch is an
error state, not an empty array.

Add a contract test per channel asserting that the renderer type and the main-process return type are
derived from the same schema.

## Workstream 4: Honest Availability Labels

The editor must not offer choices the system cannot execute. Strategy and experience metadata carry the
support state from Solution 03's driver table and Solution 02 Workstream 4:

```text
available            — reachable producer, certified route
forward_paper_only   — runnable live-paper, not backtestable
blocked              — named blocker, selectable only for sentinel sessions
```

`blocked` entries appear with their blocker text and cannot be assigned to a non-sentinel session.
`options-flow` is `blocked` until Solution 10 lands.

## Tests

### Unit

- A rejected `listTemplates()` renders an error with retry, not an empty catalog.
- A resolved-but-empty `listTemplates()` renders the empty state.
- Save is disabled while any required resource is in `error`.
- Each configuration-time validation blocks or warns exactly as specified.
- A `blocked` experience cannot be assigned to a non-sentinel session.

### Composition

Drive the editor against a real IPC harness with the catalog repository throwing. Assert the user sees
the failure and cannot create a session from it.

### E2E

Create a session end to end; force a mid-flow catalog failure; assert the flow surfaces it and recovers
on retry without losing entered state.

## Acceptance Criteria

- [ ] No `.catch` in the session configuration surface discards an error.
- [ ] Failed load and empty result are visually and semantically distinct.
- [ ] `templateError` is either used or removed; dead state fields are not left declared.
- [ ] All session-configuration loads use one `AsyncResource` contract.
- [ ] A session cannot be created with an unreachable producer, incompatible class, or uncertified route.
- [ ] Insufficient history warns with exact counts and offers provisioning.
- [ ] Blocked experiences are labeled and restricted to sentinel sessions.
- [ ] Every configuration IPC channel is schema-validated on both sides.
