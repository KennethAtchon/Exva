# Legacy IPC inventory (Phase 5)

> **Date:** 2026-07-12  
> **Updated:** 2026-07-12 — five unused legacy channels deleted end-to-end (no React callers).  
> **Sources:** `docs/architecture/ai-runtime.md` §14; `electron/shared/domain/session.ts` SessionConfig TODO; channel map in `electron/shared/ipc/channels.ts`.

## Context

ai-runtime §14 notes that some legacy IPC/config APIs remain beside newer session/workspace/strategy surfaces. Phase 5 of the 50→100 plan inventories them; deletion is gated on UI no longer calling them.

## Compatibility bridges (domain, not channels)

| Surface                                   | Location                                  | Notes                                                                                                                                                                               |
| ----------------------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SessionConfig` + `toLegacySessionConfig` | `electron/shared/domain/session.ts`       | TODO(phase-05/phase-07): remove once renderer/main use canonical `SessionStrategy` + per-role AI config. Still used by orchestrator cycle context (not via deleted `config:*` IPC). |
| Legacy EDGAR-shaped `SignalEvent` bridge  | `electron/shared/domain/signal-bridge.ts` | Dual-read/write for MarketSignal migration — not IPC, but same “compat until callers move” class.                                                                                   |

## Deleted legacy IPC channels (2026-07-12)

Removed channel keys, main handlers, preload/`exva` wrappers, and `BrokerService` deprecated stubs. Kept `strategy:*` and `accounts:brokers:*`.

| Channel                  | Was handled in                              | Replacement                                            | Status  |
| ------------------------ | ------------------------------------------- | ------------------------------------------------------ | ------- |
| `config:get-strategy`    | `ipc/workspace/config.ts` (file deleted)    | `strategy:get*` / session strategy context             | Deleted |
| `config:save-strategy`   | same                                        | `strategy:save-risk-config` (+ related strategy saves) | Deleted |
| `accounts:save-broker`   | `ipc/workspace/accounts.ts` → BrokerService | `accounts:brokers:add` / `broker-accounts:*`           | Deleted |
| `accounts:test-broker`   | same                                        | `accounts:brokers:test` / `test-ephemeral`             | Deleted |
| `accounts:remove-broker` | same                                        | `accounts:brokers:remove`                              | Deleted |

## Still-active research / experiences IPC (not legacy)

These sit next to the legacy list but are current Phase 5 surfaces — keep:

- `experiences:list`, `getScorecard`, `listScorecards`, `listExperiments`, `recordExperiment`, `compareExperiments`, `getResearchSummary`
- `experiences:approveLadderUpgrade` (new — ladder automation tap)

## Preload orphans (may be dead or main-only)

`electron/shared/ipc/__tests__/ipc-contract.test.ts` asserts some `channels.*` paths are absent from preload (intentional orphans). Re-check before deleting:

- `channels.session.buildCycleFixture`
- `channels.experiences.listExperiments` (and siblings if not exposed)
- `channels.workspace.viewGet`

## Deletion checklist (remaining)

1. Grep renderer + preload for each channel string.
2. Confirm no Control Agent / developer tooling invokes it.
3. Remove handler + channel + Zod schema together.
4. Only then remove `toLegacySessionConfig` / `SessionConfig` if zero remaining callers.
