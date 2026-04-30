# `docs/plan` Review

Date: 2026-04-30
Source reviewed: `docs/plan/*.md`

## High-Impact Flaws

### 1. The plan still models key runtime services as singletons while the feature requires parallel sessions

The current architecture centers on one `SessionService`, one `AgentOrchestrator`, one `TradeMonitor`, one broker service, and one session status source. The plan adds multi-session persistence and UI, but it never introduces a `SessionRuntimeManager`-style layer that owns one runtime per active session.

Why this matters:
- `phase-04-sessions-page.md` allows multiple sessions to exist and be focused.
- `phase-08-broker-routing.md` and `phase-09-instrument-selector.md` assume session-specific trade execution.
- `phase-06-approval-queue.md` and the source spec both assume multiple sessions can be active in parallel.

What is missing:
- A runtime container keyed by `sessionId`
- Per-session orchestrator lifecycle (`start`, `pause`, `resume`, `stop`)
- Per-session monitor/subscription ownership
- App-launch rehydration of all active sessions, not just one

Without this, the plan upgrades storage and UI but not the execution model that actually makes parallel sessions possible.

### 2. Broker routing is defined as both global and per-session in different phases

The routing model is inconsistent across the docs:
- `phase-01-session-ownership.md` defines `BrokerRouting` as `{ instrumentClass, defaultBrokerAccountId }`
- `phase-02-db-migration.md` makes `broker_routing.instrument_class` the primary key, which implies one global default per instrument class
- `phase-08-broker-routing.md` says each session has broker assignments and the routing service calls `getForSession(sessionId, instrumentClass)`

These cannot all be true at once.

What needs to be decided:
- Global routing only
- Session-scoped routing only
- Global default plus optional session override

If session-scoped routing is the intent, `broker_routing` needs `session_id` in the key and the earlier phases need to be updated.

### 3. Approval rehydration after restart does not persist enough state to actually resume execution

`phase-06-approval-queue.md` proposes recreating promise callbacks on restart and then resolving them later. That is not enough by itself. After a process restart, the original suspended async call stack is gone.

What is persisted today in the proposed model:
- approval row
- trade row

What is not clearly persisted:
- the exact post-approval execution intent
- the validated order payload that should be sent to the broker
- whether risk checks must be rerun
- whether the decision context is still valid after restart

This means `resolveApproval()` may wake a new callback, but there is no guaranteed continuation that can safely place the order.

The plan needs an explicit restart-safe continuation design, for example:
- persist a resumable approval work item containing the order request and session runtime inputs, or
- treat post-restart approvals as "re-evaluate then place" instead of "resume suspended promise"

### 4. `aiPickerEnabled` appears late but is never added to the canonical domain or schema

`phase-09-instrument-selector.md` depends on `aiPickerEnabled`, but earlier phases never define or persist it:
- not in `WorkspaceSession` in `phase-01-session-ownership.md`
- not in `SessionStrategy` in `phase-01-session-ownership.md`
- not in the `sessions` or `session_strategies` tables in `phase-02-db-migration.md`
- not in the `session:create` / `session:update` contract in `phase-04-sessions-page.md`

So Phase 9 depends on a field that does not exist in the plan's source-of-truth types or tables.

The missing piece is not cosmetic. The spec distinguishes:
- `selectionMode = "ai_selected_universe"`
- selector role configured but disabled
- selector role configured and enabled

That state needs a real home in the data model.

### 5. Provider account metadata is used in Phase 7 but not modeled anywhere earlier

`phase-07-ai-providers-prompts.md` uses `account.metadata?.baseUrl` for OpenCode-compatible providers and exposes `metadata` in `accounts:providers:save`, but `ProviderAccount` and `provider_accounts` do not include metadata fields in Phases 1 or 2.

That leaves no canonical place to store:
- custom base URL
- future OpenAI-compatible provider options
- provider-specific settings beyond a single secret ref

This should be fixed before implementation starts, otherwise Phase 7 will be forced to introduce a schema surprise midstream.

## Important Gaps

### 6. Shared global pool mode is stored in preferences but not enforced anywhere

The spec includes `shared_global_pool`, and the plan adds fields for it in `workspace_preferences`, but no phase defines:
- how available capital is reserved across active sessions
- whether pending approvals reserve capital
- whether open orders reserve capital
- how concurrent order placement avoids oversubscription

Right now the plan stores the setting and renders UI for it, but there is no risk-engine or transactional enforcement design behind it.

### 7. Selector cache invalidation rules are missing

`phase-09-instrument-selector.md` persists `session_instrument_cache`, but the plan only clears it manually.

Missing invalidation triggers:
- session `instrumentScope` changes
- `instrumentClasses` changes
- broker assignment/routing changes
- strategy changes that materially affect selection
- selector provider/model/prompt changes

Without automatic invalidation, a session can run against a stale universe that no longer matches its saved definition.

### 8. Search provider selection is underspecified

The plan introduces search providers and `webSearchEnabled`, but it does not define how a role chooses which search provider to use.

Possible models:
- one workspace-wide default search provider
- one per-session default search provider
- one per-role search provider

The spec's Accounts page mentions a default provider selector, but the implementation plan does not carry that through into the schema or runtime resolution path.

### 9. The crypto/futures proof-of-concept scope is not actually planned end-to-end

The spec explicitly says v1 should include real proof-of-concept support for stocks, crypto, and futures. The implementation plan mostly renames fields and adds `InstrumentClass`, but the concrete execution path still only names a real stock broker integration (`Alpaca`) plus a mock adapter.

Missing from the plan:
- at least one real crypto-capable adapter
- at least one real futures-capable adapter
- instrument-specific symbol normalization rules
- execution/risk differences for non-stock assets

As written, the plan reaches "multi-class-shaped abstractions" sooner than it reaches actual multi-class support.

### 10. Phase 10 has an internal file-placement contradiction

`phase-10-services-refactor.md` says:
- target tree: `electron/main/broker/broker-registry.ts`
- file moves table: `services/broker/broker-registry.ts`
- example imports: `../broker/broker-registry`

One location needs to win. Otherwise this phase will create churn for no product value.

## Resolved Decisions

1. Runtime model: recommend a `SessionRuntimeManager` that owns one long-lived runtime object per active session, not purely stateless per-cycle workers.
   Why: the long-lived model is more efficient for this app because subscriptions, trade monitors, caches, approval state, and pause/resume lifecycle stay warm instead of being rebuilt every cycle. Purely stateless workers reduce resident memory and can be simpler to isolate, but they add more startup churn, reconnect/reload overhead, and make restart/continuation logic harder.
2. Broker routing: use global defaults with optional per-session overrides.
3. Restart approval behavior: force a fresh decision/risk pass after restart as a safety mechanism; do not blindly resume the exact prior intent.
4. `aiPickerEnabled`: store it in a dedicated `session_selector_settings` object keyed by `sessionId`, not in `sessions` or `session_strategies`.
5. Search provider selection: use workspace default plus optional per-session override. No per-role search-provider picker in v1. A search provider is the backend used when an AI role enables `webSearchEnabled`.
6. v1 proof-of-concept integration scope: explicitly require one real adapter each for stocks, crypto, and futures. Baseline set: `AlpacaAdapter` for stocks, `CoinbaseAdvancedTradeAdapter` for crypto, and `TradovateAdapter` for futures. Anything less should be described as abstractions-only, not real proof of concept.
7. `session_instrument_cache` invalidation: invalidate automatically on any selector-definition change. Minimum triggers are `selectionMode`, `aiPickerEnabled`, `instrumentScope`, `instrumentClasses`, session broker assignments, session routing overrides, relevant workspace routing defaults, selector provider/model/prompt/search settings, and resolved search provider. Implement this through a persisted selector `definitionHash`, not scattered manual clears.
8. Shared-global-pool reservation: yes, capital should be reserved across concurrent sessions. Recommended default is to reserve on approval, then release or reconcile on reject, cancel, fill, or expiration.

## Recommended Next Fixes To The Plan

1. Add a new early phase or cross-cutting design section for session runtime management.
2. Normalize the broker routing model across Phases 1, 2, 4, and 8.
3. Add missing schema/domain fields now: `aiPickerEnabled`, provider metadata, and search-provider selection.
4. Redesign approval restart behavior around persisted resumable work, not recreated promises.
5. Decide whether v1 really includes live crypto/futures execution or only the abstractions for it.
