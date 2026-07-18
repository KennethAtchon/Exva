# AI Capability Parity — Control Agent vs Full User Surface

Audit date: 2026-07-17. Audience: an executing AI agent. Goal state: the assistant can do everything the user can do in the UI (with sane confirmation gates), so Ken can operate Exva by conversation alone.

### TLDR: shortcuts taken

- The user-action surface was enumerated from the preload bridge (`electron/preload/exva-api.ts`) as the source of truth; individual panel components were sampled, not exhaustively diffed against the bridge.
- "~130 user actions / ~15% covered" is a count of bridge methods, not weighted by usage frequency.
- Confirmation-policy recommendations (which new tools need `alwaysConfirm`) are judgment calls, not Ken-approved policy — see Core Decisions.

### User journey (target)

1. Ken opens the assistant and says "pause everything, something looks wrong." The assistant calls the kill switch, confirms once, and reports gauge state.
2. "What's pending my approval?" — assistant lists the approval queue with sizes and risk, and can decide entries after explicit confirmation.
3. "How am I doing today?" — assistant reads dashboard stats, equity curve, cost breakdown, and summarizes without touching anything.
4. "Loosen the stop on Momentum-A and switch it to the 15m timeframe" — assistant patches risk + timeframe config behind one confirmation each.
5. Anything credential-shaped (broker keys, AI provider keys) it declines and points to the right settings screen.

### Core decisions (sign-off required)

1. **Approve/decide trades via chat** (`decide_approval`): recommended yes with `alwaysConfirm` on approvals. Alternative: keep approvals UI-only (safer, but breaks the "do everything by voice" goal).
2. **`flatten_all` via chat**: recommended yes, `alwaysConfirm` + live-risk warning. This is the emergency command that most justifies the assistant existing.
3. **Credential operations stay UI-only** (add/remove broker, AI provider keys): recommended yes; system prompt should say so explicitly so the assistant redirects.
4. **Fix the 4 safety/loop defects (§5 items 1, 3, 4, 6) BEFORE adding more mutating tools**: recommended hard requirement.

---

## 1. How the control agent works end-to-end

The control agent is a main-process service (`electron/main/services/control/control-agent-service.ts`) driven from the slide-over chat UI. The renderer calls `control.send` over IPC (`electron/main/ipc/control.ts:64-78`) → `ControlAgentService.startTurn` (`control-agent-service.ts:54-84`). The service persists the user message, builds the message list from persisted history plus a static system prompt with a compact app-state snapshot appended (`control-agent-service.ts:136-144`; snapshot at `:310-354`: active/paused sessions, open-trade count + notional, enabled signal sources, conversation scope). It resolves the workspace default model (`:146-158`) and hands off to a provider adapter's `runAgent` with the toolset, `maxSteps: 12`, and a $0.50 per-turn spend cap (`:20-21, 184-194`).

Tools are declarative "capabilities" (`capability.ts:13-38`): key, kind (`read`/`mutating`), Zod input schema, human `describe()` preview, optional `risk()` note and `confirmClass`. `buildControlToolset` (`build-control-toolset.ts:245-259`) wraps each into an AI-SDK tool whose executor (`runCapability`, `build-control-toolset.ts:39-243`) handles the lifecycle: read tools run immediately; mutating tools insert an `awaiting_confirm` row, emit `control_confirmation_required`, and suspend on a promise until the user clicks Confirm/Reject (IPC `control.confirm`/`control.reject` → `resolveConfirmation`, `control-agent-service.ts:86-105`). A per-conversation "don't ask again" set (`autoApproved`, persisted via `repo.setAutoApproved`, `:176-179`) skips confirmation for a capability class, except when `alwaysConfirm: true` or the `risk()` string matches `/live/i` (`build-control-toolset.ts:115-120`). Tool calls/results are persisted (`control_tool_calls`) and mirrored to the renderer as events. When `runAgent` returns, the final assistant text is persisted and emitted as a single `control_delta` + `control_turn_complete` (`control-agent-service.ts:205-233`) — **no token-level streaming**.

```
Renderer chat → IPC control.send → startTurn → runTurn
  → system prompt + app-state block + history
  → adapter.runAgent (max 12 steps, $0.50 cap)
      → tool call → runCapability
          read: execute immediately
          mutating: persist awaiting_confirm → emit confirmation_required
                    → UI ConfirmationCard → IPC confirm/reject → resume
          → execute via AppServices → persist + emit result
  → persist assistant message → emit control_delta (full text) → turn_complete
```

## 2. Current tool inventory (17 tools)

All defined in `electron/main/services/control/capabilities.ts` (registry `:437-457`).

| Tool                    | Lines   | Kind   | Does                                                        | Confirmation                                                |
| ----------------------- | ------- | ------ | ----------------------------------------------------------- | ----------------------------------------------------------- |
| `list_sessions`         | 42-64   | read   | Session list with status/mode/open count                    | none                                                        |
| `get_session_status`    | 66-99   | read   | One session: lifecycle, brokers, subscriptions, open trades | none                                                        |
| `list_active_trades`    | 101-133 | read   | Open/pending trades + notional                              | none                                                        |
| `get_strategy`          | 135-147 | read   | Strategy page data                                          | none                                                        |
| `list_signal_sources`   | 149-160 | read   | Signal sources + enabled state                              | none                                                        |
| `get_signal_readiness`  | 162-185 | read   | Readiness diagnosis                                         | none                                                        |
| `list_brokers`          | 187-205 | read   | Broker accounts, paper/live, classes                        | none                                                        |
| `create_session`        | 209-228 | mutate | `sessionWrites.create`                                      | class `session_lifecycle`; live risk note if `live_allowed` |
| `start_session`         | 253-258 | mutate | `session.start`                                             | class `session_lifecycle`                                   |
| `pause_session`         | 259-264 | mutate | `session.pause`                                             | class `session_lifecycle`                                   |
| `resume_session`        | 265-270 | mutate | `session.resume`                                            | class `session_lifecycle`                                   |
| `stop_session`          | 271-276 | mutate | `session.stop`                                              | class `session_lifecycle`                                   |
| `save_risk_config`      | 278-301 | mutate | Partial risk patch                                          | class `strategy_write`                                      |
| `enable_signal_source`  | 303-316 | mutate | `signals.enableSource`                                      | class `signal_write`                                        |
| `disable_signal_source` | 318-331 | mutate | `signals.disableSource`                                     | class `signal_write`                                        |
| `force_close_trade`     | 333-391 | mutate | Broker close + status update                                | **alwaysConfirm** + live risk                               |
| `run_period_autopsy`    | 393-435 | mutate | `periodAutopsy.run` (costs tokens)                          | class `autopsy`                                             |

## 3. Parity matrix

Surface = the preload bridge `electron/preload/exva-api.ts` (complete IPC contract consumed by `src/hubs/` + panels). ✅ covered, 🟡 partial, ❌ missing.

### Sessions (`exva-api.ts:148-235`)

| User action                                                                     | Assistant tool                        | Status                    |
| ------------------------------------------------------------------------------- | ------------------------------------- | ------------------------- |
| list / getStatus                                                                | `list_sessions`, `get_session_status` | ✅                        |
| create                                                                          | `create_session`                      | ✅                        |
| start/pause/resume/stop                                                         | lifecycle tools                       | ✅                        |
| `forceStop`                                                                     | —                                     | ❌                        |
| `update` (edit session config)                                                  | —                                     | ❌                        |
| `archive`, `duplicate`                                                          | —                                     | ❌                        |
| `focus` / `goGlobal`                                                            | —                                     | ❌                        |
| `getExecutionProgress`, `retryStep`, `pauseAfterCurrentStep`, `clearFailedStep` | —                                     | ❌                        |
| instrument cache get/clear                                                      | —                                     | ❌                        |
| live readiness get/acknowledge/testLiveBrokerConnection                         | —                                     | ❌                        |
| debugInjectSignal / debugForceTrade                                             | —                                     | ❌ (dev-only; acceptable) |

### Trades & approvals (`exva-api.ts:91-113`)

| User action                           | Tool                 | Status                                                                           |
| ------------------------------------- | -------------------- | -------------------------------------------------------------------------------- |
| trades.listActive                     | `list_active_trades` | 🟡 no filters, no PnL detail                                                     |
| trades.getDetail                      | —                    | ❌                                                                               |
| trades.forceClose                     | `force_close_trade`  | ✅                                                                               |
| trades.approve                        | —                    | ❌                                                                               |
| **approvals.list / approvals.decide** | —                    | ❌ **critical** — the human-in-the-loop trade gate is invisible to the assistant |

### Kill switch (`exva-api.ts:837-845`; `electron/main/services/operator/kill-switch-service.ts:57-152`)

| pauseAll / killSession / flattenAll / gauges | — | ❌ **critical** — "stop everything now" is the single most voice-worthy command |

### Strategy (`exva-api.ts:289-376`; `session-strategy-context-service.ts:156-229`)

| get / getPageData | `get_strategy` | ✅ |
| saveRiskConfig | `save_risk_config` | ✅ |
| saveResearchPosture / saveRules / saveTimeframeConfig / saveAiSettings / saveSelectorSettings | — | ❌ (prompt claims "tuning sessions" but only risk is writable) |
| strategyConfig doc: get/update/applyPreset/presets CRUD/history/rollback | — | ❌ |
| workspace default model get/save | — | ❌ |

### Signals (`exva-api.ts:377-453`)

| listSources / enable / disable / getSessionReadiness | 4 tools | ✅ |
| createSource / updateSource / deleteSource / testSource | — | ❌ |
| listSessionEvents / listSessionDeadLetters / replaySignalDeadLetter | — | ❌ |

### Brokers & providers (`exva-api.ts:242-261, 454-520`)

| brokerAccounts.list | `list_brokers` | 🟡 no balances/state |
| refreshBalance / updateSettings / resetPaperBalance | — | ❌ |
| addBroker / removeBrokerAccount / testBrokerAccount / routing get+update | — | ❌ (credential entry reasonably UI-only; routing/read/test are not) |
| accounts.\* (AI provider keys) | — | ❌ (secrets — intentional exclusion is defensible) |

### Autopsy (`exva-api.ts:114-140`)

| period.run | `run_period_autopsy` | ✅ |
| period list/get/preview/lessons/promote/export | — | ❌ |
| trade autopsy summarize/list/lessons/export | — | ❌ |

### Everything else — all ❌, no tools at all

- Dashboard stats / cost breakdown / calendar attention (`exva-api.ts:77-90`)
- Experiences + scorecards (`:141-147`)
- Session templates list/create/delete/use (`:262-288`)
- Events, agent traces, API call log (`:692-712`)
- Experience catalog, instrument sets, source definitions, session inputs (`:713-775`)
- Backtest lab: list/run/compare/sweep (`:789-801`)
- Data doctor: coverage/gaps/backfill/provider health (`:802-815`)
- Morning briefing (`:816-821`), equity curve/attribution/snapshot (`:822-828`), what-if replay (`:829-836`)
- Workspace view/preferences (`:236-241`), ops: backup/notifications/alarms (`:630-691`), developer tools (`:557-629` — fine to exclude)
- Palette query (`:776-788`)

**Bottom line: 17 tools cover roughly 15% of ~130 user-facing actions.** Reads are the weakest area relative to their cost — the assistant cannot answer "how am I doing today?", "what's pending approval?", "what did that trade cost?", or "show my equity curve" — all zero-risk reads.

## 4. Ranked gap list — implementation instructions

All new tools go in `electron/main/services/control/capabilities.ts` (or sibling files re-exported into `CONTROL_CAPABILITIES` at `capabilities.ts:437`) using `defineCapability`. Nothing else needs wiring — the toolset builder, confirmation UX, audit persistence, and event plumbing are generic.

### P0-1: Trade approvals (list + decide)

- `list_pending_approvals` (read): reuse the handler logic at `electron/main/ipc/trading/approvals.ts:103-159` — extract the body into a shared helper both call.
- `decide_approval` (mutating): import the already-exported `decideApproval(services, {approvalId, decision, decisionNote})` from `electron/main/ipc/trading/approvals.ts:12-91`.
- Confirmation: `alwaysConfirm: true` for `decision: "approved"`; `risk()` checks the session's broker mode (mirror `force_close_trade` at `capabilities.ts:352-365`). Rejections may use `confirmClass: "trade_execution"` without alwaysConfirm.

### P0-2: Kill switch

- `pause_all_sessions` → `services.killSwitch.pauseAll()` (`kill-switch-service.ts:57`). `confirmClass: "session_lifecycle"`, no alwaysConfirm — safety action, keep friction low.
- `kill_session` → `services.killSwitch.killSession(id)` (`:86`); resolve via existing `resolveSession` helper (`capabilities.ts:15-29`).
- `flatten_all` → `services.killSwitch.flattenAll(confirmation)` (`:105`) — `alwaysConfirm: true` + `risk()` returning a live warning when any live broker has open trades.
- `get_kill_gauges` (read) → `services.killSwitch.gauges()` (`:95`).

### P0-3: Read parity sweep (zero-risk, highest answer-value)

All `kind: "read"`, direct service calls; trim outputs to compact JSON (follow `list_sessions` mapping style, `capabilities.ts:54-62`) — these feed a $0.50-capped context.

- `get_dashboard_stats` / `get_cost_breakdown` → same services as `electron/main/ipc/system/dashboard.ts` handlers.
- `get_trade_detail` → mirror `electron/main/ipc/trading/trades.ts` detail handler.
- `get_equity_curve` → `services.equitySnapshots` (shape per `exva-api.ts:822-828`).
- `get_latest_briefing` → `services.morningBriefing`.
- `list_events` (filtered, capped limit) → `services.repos.events`.
- `list_experiences` / scorecards → `services.experienceScorecard`.

### P1-4: Full strategy write parity

One capability per save method on `SessionStrategyContextService` (`session-strategy-context-service.ts:156-229`): `save_research_posture`, `save_trade_rules`, `save_timeframe_config`, `save_ai_settings`, `save_selector_settings` — all `confirmClass: "strategy_write"`, same shape as `save_risk_config` (`capabilities.ts:278-301`). Also `update_strategy_config` / `apply_strategy_preset` / `rollback_strategy_config` via `services.strategyConfig` — these use optimistic `expectedVersion`; the tool must read the current version internally and pass it so the model never guesses versions.

### P1-5: Session management completion

- `update_session` → `services.sessionWrites` (see `electron/main/ipc/session/session.ts` update handler); `confirmClass: "session_lifecycle"`; `risk()` when patch flips executionMode to `live_allowed`.
- `archive_session`, `duplicate_session` → same service, class `session_lifecycle`.
- `force_stop_session` → `services.session.forceStop`; `alwaysConfirm: true` if open trades exist.
- `get_execution_progress` (read); `retry_step` / `clear_failed_step` / `pause_after_current_step` (mutating, class `session_lifecycle`) → mirror `exva-api.ts:155-168` handlers.
- `get_live_readiness` (read) → `services.liveReadiness`. Leave `acknowledgeLiveReadiness` UI-only (explicit human attestation).

### P1-6: Signal source CRUD + diagnostics

- `create_signal_source` / `update_signal_source` / `delete_signal_source` → `services.signals.*` (delete: `alwaysConfirm: true` if attached sessions > 0).
- `test_signal_source` (read — poll only) → `services.signals.testSource`.
- `list_session_signal_events`, `list_dead_letters` (read), `replay_dead_letter` (mutating, class `signal_write`) → per `exva-api.ts:414-442`.

### P2-7: Templates, backtests, autopsy browsing, data doctor

- Templates: `list_templates` (read); `use_template`/`create_template`/`delete_template` (new class `template_write`) → `services.sessionTemplates`.
- Backtest: `list_backtests`/`get_backtest` (read); `run_backtest` (mutating, new class `backtest`; `describe()` must state token/compute cost like `run_period_autopsy` does at `capabilities.ts:413-414`) → `services.backtestLab`.
- Autopsy browsing: `list_period_autopsies`, `get_period_autopsy`, `list_autopsy_lessons` (read); `promote_lesson` (mutating, class `autopsy`) → `services.periodAutopsy`, `services.tradeAutopsy`.
- Data doctor reads (`coverage`, `providerHealth`) + `run_backfill` (mutating).

### P2-8: Broker account ops (non-credential)

`refresh_broker_balance` (hits broker API — make it mutating, new class `broker_ops`), `reset_paper_balance` (mutating), `get_broker_routing`/`update_broker_routing`. Keep add/remove broker and all credential entry UI-only, and state that in the system prompt so the assistant redirects instead of flailing.

## 5. Agent-loop quality defects (fix 1, 3, 4, 6 before adding mutating tools)

1. **Tool results are lost from history.** `loadHistory` (`control-agent-service.ts:294-307`) replays only user/assistant text; tool calls/results (persisted in `control_tool_calls`) are never re-fed. On turn 2 the model no longer knows the ids it read on turn 1 — it re-burns budget on reads or hallucinates. Fix: replay tool calls+results as proper tool-role messages (or a compact per-turn summary block).

2. **No token streaming.** `control_delta` fires once with the full text (`control-agent-service.ts:218-222`); the adapter API (`electron/main/services/llm/adapters/provider-adapter.ts`) has no delta callback. Multi-step turns look frozen. Fix: add `onTextDelta` to `AgentRunOptions`, forward to `control_delta`.

3. **Live-action gating is a regex on prose.** `liveRisk = /live/i.test(risk)` (`build-control-toolset.ts:116`). Safety depends on capability authors writing the word "live" into free text; "no live impact" force-confirms. Fix: `risk()` returns structured `{ level: "live" | "normal", note }`.

4. **Auto-approve gap: starting a live session skips confirmation.** `start_session`/`resume_session` (`capabilities.ts:253-270`) have no `risk()`. After one "always approve" on `session_lifecycle` (e.g. pausing a paper session), the assistant can start a `live_allowed` session with zero confirmation. `create_session` guards this (`:223-227`); the lifecycle verbs don't. Fix: give `lifecycleCapability` a `risk()` checking `executionMode === "live_allowed"` and assigned brokers' `mode === "live"`.

5. **Whole-class auto-approve is coarse.** One "don't ask again" on `session_lifecycle` covers create/start/pause/resume/stop across all sessions for the conversation lifetime (`build-control-toolset.ts:172-179`; classes `capabilities.ts:7-13`). Consider per-capability or per-entity keys (e.g. `start_session:paper`).

6. **Scope is prompt-enforced only.** The system prompt says out-of-scope writes "require you to name the target explicitly" (`control-system-prompt.ts:10`), but `CapabilityContext.scope` (`capability.ts:8`) is never checked in `runCapability` or any `execute`. A session-scoped conversation can mutate any session. Fix: in `runCapability`, when `ctx.scope.kind === "session"` and the resolved target differs, escalate to forced confirmation (or annotate the confirmation card).

7. **App-state context is thin and route-blind.** `buildAppStateContext` (`control-agent-service.ts:310-354`) omits pending approvals, kill-gauge state, broker balances, and the user's current screen. "Approve that" / "close this one" can't resolve. Fix: include pending-approval count + ids; optionally have the renderer pass current route/selected entity with `control.send`.

8. **Confirmation deadlock has no timeout.** `awaitConfirmation` (`control-agent-service.ts:167-175`) suspends forever; if the renderer never answers, the turn holds the conversation lock (`startTurn` throws while active, `:58-63`) indefinitely. Add a timeout resolving as cancel after N minutes.

9. **Budget will bind.** 12 steps / $0.50 (`control-agent-service.ts:20-21`) is fine at 17 tools; once the tool count triples, read-heavy turns will hit the cap. Consider raising step limit for read-only sequences. (Error surfacing is already good: failures return `{error}` rather than throwing — `build-control-toolset.ts:110, 241`.)

10. **`summarizeResult` hides substance** (`build-control-toolset.ts:28-37`): every success renders "Done." on the tool card. Mutations should surface the created/affected entity (per-capability result summarizers, `describe()`-style).

**Overall:** the capability framework is well-built — declarative, audited, confirmation-gated, easy to extend. The gap is almost entirely breadth (17 tools vs ~130 actions) plus the safety/context defects above.
