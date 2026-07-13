# Legacy IPC inventory (Phase 5) — COMPLETE

> **Date:** 2026-07-12  
> **Status:** Complete  
> **Archived:** moved to `docs/attic/` after finish-line/01 T4.  
> **Sources:** `docs/architecture/ai-runtime.md` §14; channel map in `electron/shared/ipc/channels.ts`.

## Final disposition (T4 — 2026-07-12)

Grep coverage for every candidate: `src/`, `electron/preload/`, `electron/main/services/control/` (incl. `build-control-toolset.ts`), `scripts/`, and IPC-only tests.

### Deleted (no end-to-end caller outside IPC-handler tests)

| Channel                            | Was handled in          | Why deleted                                                                        |
| ---------------------------------- | ----------------------- | ---------------------------------------------------------------------------------- |
| `session:buildCycleFixture`        | `ipc/session/replay.ts` | No renderer/preload/control/scripts caller                                         |
| `session:saveCycleFixture`         | same                    | Sibling of buildCycleFixture; same dead surface                                    |
| `session:getPaperScorecard`        | same                    | Sibling; paper scorecard still used internally by live-readiness, not via this IPC |
| `experiences:listExperiments`      | `ipc/analytics.ts`      | No renderer/preload/control/scripts caller                                         |
| `experiences:recordExperiment`     | same                    | Sibling; UI never called                                                           |
| `experiences:compareExperiments`   | same                    | Sibling; UI never called                                                           |
| `experiences:getResearchSummary`   | same                    | Sibling; UI never called                                                           |
| `experiences:approveLadderUpgrade` | same                    | Ladder service kept; IPC tap unused                                                |

`registerReplayHandlers` / `electron/main/ipc/session/replay.ts` removed entirely (all three channels gone). Related IPC tests deleted.

### Kept (alive)

| Channel                      | Why kept                                                                           |
| ---------------------------- | ---------------------------------------------------------------------------------- |
| `workspace:view:get`         | Renderer via `bridge().workspace.getView()` → preload `workspaceEndpoints.getView` |
| `workspace:prefs:patch`      | Renderer via `patchPreferences` → `workspaceEndpoints.patchPreferences`            |
| `experiences:list`           | Preload + `src/lib/exva.ts`                                                        |
| `experiences:getScorecard`   | Preload + `src/lib/exva.ts`                                                        |
| `experiences:listScorecards` | Preload + `src/lib/exva.ts`                                                        |

`viewGet` / `prefsPatch` looked like preload orphans only because preload references them through `workspaceEndpoints` rather than the literal `channels.workspace.*` path string. `ipc-contract.test.ts` now scans `endpoints.ts` as well.

## Earlier deletions (2026-07-12, pre-T4)

| Channel                  | Replacement                                  | Status  |
| ------------------------ | -------------------------------------------- | ------- |
| `config:get-strategy`    | `strategy:get*` / session strategy context   | Deleted |
| `config:save-strategy`   | `strategy:save-risk-config` (+ related)      | Deleted |
| `accounts:save-broker`   | `accounts:brokers:add` / `broker-accounts:*` | Deleted |
| `accounts:test-broker`   | `accounts:brokers:test` / `test-ephemeral`   | Deleted |
| `accounts:remove-broker` | `accounts:brokers:remove`                    | Deleted |

## Domain bridges (handled elsewhere in finish-line/01)

| Surface                                        | Status        |
| ---------------------------------------------- | ------------- |
| `SessionConfig` + `toLegacySessionConfig`      | Deleted in T1 |
| Legacy EDGAR-shaped `SignalEvent` bridge       | Deleted in T2 |
| Deprecated `timer` / `web_search` source types | Purged in T3  |
