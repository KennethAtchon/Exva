# Workspace Default AI Model Audit Plan

> **Date:** 2026-05-12
> **Status:** Partially Implemented
> **Deciders:** Kenneth

### 1. Problem Statement

The `Workspace default AI model` setting is being saved successfully, but it is not acting as the canonical default for new sessions. The UI currently implies that setting this once will pre-fill every AI role on new sessions, yet new `session_ai_roles` rows are actually created with hardcoded Anthropic values instead. This creates a mismatch between what Accounts promises, what Strategy displays, and what the persisted session data contains. The immediate result is that a user can set a workspace default like OpenRouter + `google/gemma-4-31b-it`, create a new session, and still get `provider-anthropic` + `claude-sonnet-4-6` in the database. If Anthropic is not configured, session start then fails preflight even though a workspace default exists.

### 2. Goals & Non-Goals

**Goals**

| #   | Goal                                                                                   | Success Looks Like                                                                                                 |
| --- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 1   | Make the workspace default model the real source of truth for net-new session AI roles | Creating a new session persists all five AI roles with the workspace default provider/model when one is configured |
| 2   | Remove renderer-only fallback behavior as the primary mechanism                        | Strategy no longer depends on UI decoration to make new sessions look configured                                   |
| 3   | Align all creation paths with one explicit rule                                        | Plain create, template-based create, and any other net-new path apply the same seeding policy                      |
| 4   | Add regression coverage around persistence, not just UI state                          | Tests fail if new sessions ever fall back to hardcoded Anthropic defaults again                                    |

**Non-Goals**

| #   | Non-Goal                                                                 | Reason                                                                                                    |
| --- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| 1   | Reworking the full AI role editor UX                                     | The bug is in session creation/persistence, not Strategy page layout                                      |
| 2   | Introducing per-role workspace defaults                                  | Current product surface is one provider/model pair for all roles                                          |
| 3   | Changing duplicate-session semantics unless required by product decision | Duplicates may intentionally preserve source-session roles rather than re-seeding from workspace defaults |

### 3. Background & Context

The current implementation is split across three different layers:

1. The Accounts page saves the workspace default provider/model into `workspace_preferences` and tells the user it will auto-fill all AI roles on new sessions. (`src/pages/AccountsPage.tsx:418-481`)
2. The Strategy store applies a read-time fallback only when it loads a session and sees an empty `providerKey` or `modelId`. (`src/store/strategyStore.ts:106-124`)
3. New sessions are actually seeded in `SessionRepo.create()`, which inserts five `session_ai_roles` rows using hardcoded `provider-anthropic` / `claude-sonnet-4-6` values. (`electron/main/db/repositories/session-repo.ts:179-194`)

That means the fallback in Strategy never fires for new sessions, because the rows are not empty. The stored values are already non-empty hardcoded defaults.

There is a second mismatch after session creation: preflight and runtime startup validate persisted role rows directly, not the renderer's decorated in-memory view. (`electron/main/services/session/preflight/provider-credentials-check.ts:6-52`) So even in a future version where the renderer displayed workspace-default values for blank roles, a session could still fail to start if those values were never written back to the database.

There is also a broader creation-path inconsistency:

1. Plain create uses `SessionWriteService.create()` -> `SessionRepo.create()`. (`electron/main/services/session/write-service.ts:36-59`)
2. Duplicate copies existing `session_ai_roles` rows from the source session. (`electron/main/db/repositories/session-repo.ts:312-466`)
3. Template apply returns a payload that still contains `aiRoles`, but the Sessions page only converts that payload into `SessionCreateInput` identity/boundary fields before calling `createSession()`, so template AI roles are ignored entirely during actual creation. (`electron/main/services/session/template-service.ts:96-144`, `src/components/sessions/CreateEditSessionModal.tsx:494-507`, `src/pages/SessionsPage.tsx:314-339`)

### 4. Research Summary

**State duplication and derived fallbacks**

- React's state-structure guidance explicitly warns against duplicated or contradictory state, because mirrored or decorated values drift out of sync with the real source of truth. That is exactly what is happening here: Strategy decorates role values in memory while session creation persists different values in SQLite.
- Key insight: the correct fix is to move the defaulting rule to the persistence boundary where sessions are created, not to add more renderer-side fallback logic.
- Sources:
  - https://react.dev/learn/choosing-the-state-structure

**Configuration should be stored separately from code constants**

- Twelve-Factor's config guidance is broader than this bug, but the principle still applies: deploy- or workspace-specific settings should live in configuration, not in hardcoded application constants. Here, the user-facing default model lives in `workspace_preferences`, but session creation still bypasses that config and inserts code-level constants.
- Key insight: hardcoded provider/model seed values are the wrong canonical default once a workspace-level setting exists.
- Sources:
  - https://12factor.net/config

### 5. Options Considered

**Option A: Keep the current behavior**

Leave hardcoded role seeding in `SessionRepo.create()` and rely on users to manually fix roles in Strategy.

| Dimension      | Assessment                                                      |
| -------------- | --------------------------------------------------------------- |
| Complexity     | Lowest immediate effort                                         |
| Performance    | No change                                                       |
| Reliability    | Poor; stored data continues to disagree with workspace settings |
| Cost           | Low engineering cost, high user friction                        |
| Reversibility  | Easy                                                            |
| Stack fit      | Poor fit with existing workspace-preferences model              |
| Team readiness | Trivial                                                         |

Risks: users keep seeing misleading behavior; session-start failures continue when the hardcoded provider is not configured; future code will continue building on a broken contract.

Open questions: none; this is clearly the wrong behavior.

**Option B: Expand the renderer-side fallback**

Keep session creation as-is, but add more UI logic so new sessions appear to use workspace defaults in more places, possibly auto-saving once Strategy loads.

| Dimension      | Assessment                                                 |
| -------------- | ---------------------------------------------------------- |
| Complexity     | Medium; requires more cross-screen synchronization         |
| Performance    | Slightly worse due to extra fetch/save churn               |
| Reliability    | Weak; persistence can still diverge from what the UI shows |
| Cost           | Medium engineering cost for a brittle fix                  |
| Reversibility  | Moderate                                                   |
| Stack fit      | Poor; pushes a data-integrity concern into the renderer    |
| Team readiness | High, but misdirected                                      |

Risks: hidden writes, confusing dirty-state behavior, and more paths where the UI and DB disagree.

Open questions: when would the renderer persist the decorated values, and how would session start behave if Strategy was never opened?

**Option C: Seed persisted AI roles from workspace preferences at session-creation time**

Move the defaulting rule to the canonical creation boundary. Net-new sessions should read `workspace_preferences` once, then persist all five `session_ai_roles` rows using that provider/model when configured. If no workspace default exists, persist blank provider/model fields rather than hardcoded Anthropic values.

| Dimension      | Assessment                                                            |
| -------------- | --------------------------------------------------------------------- |
| Complexity     | Moderate but contained                                                |
| Performance    | Negligible extra DB read during session creation                      |
| Reliability    | Strong; stored session state matches the configured workspace default |
| Cost           | Low-to-medium engineering effort with clear regression tests          |
| Reversibility  | Easy                                                                  |
| Stack fit      | Strong; keeps session defaults in the DB-backed configuration layer   |
| Team readiness | High                                                                  |

Risks: duplicate/template semantics must be made explicit; tests that currently assume Anthropic defaults will need updating.

Open questions: should duplicate keep source roles, and should template AI-role payloads override workspace defaults when present?

### 6. Recommendation

**We recommend Option C: seed persisted AI roles from workspace preferences at session-creation time.**

This is the only option that fixes the real bug instead of masking it. It wins over the status quo because it makes the user-facing workspace default actually control new-session persistence. It wins over the renderer-only approach because preflight, runtime, and all downstream code read from the database, not from decorated Zustand state. The key assumptions are that the workspace default is intended for net-new sessions and that hardcoded Anthropic defaults are legacy behavior, not a current product requirement. The recommendation would change only if product explicitly wants duplicate/template-created sessions to ignore workspace defaults in favor of their source payloads.

### 7. Implementation Plan

**Phase 1: Fix the canonical create path**

Goal and done criteria: a brand-new session created from the normal Sessions flow writes all five AI roles from the workspace default when configured, or blank values when no workspace default exists.

Deliverables:

- Remove hardcoded `provider-anthropic` / `claude-sonnet-4-6` seeding from `SessionRepo.create()`.
- Add one canonical resolver for the default role seed based on `workspace_preferences`.
- Persist the resolved provider/model into each inserted `session_ai_roles` row during creation.
- Decide whether this resolver lives inside `SessionRepo.create()` or is injected by `SessionWriteService`; prefer the smallest change that keeps the rule server-side and testable.

Dependencies: none beyond existing workspace preferences storage.

Risks and detection:

- Risk: blank-role sessions now fail preflight when no workspace default exists.
- Detection: create-session tests should assert either persisted workspace defaults or intentionally blank roles.

Rollback plan: restore the current hardcoded seeding behavior in `SessionRepo.create()`.

**Phase 2: Align template and duplicate semantics**

Goal and done criteria: every creation path has an explicit policy instead of accidental behavior.

Deliverables:

- Decide and document duplicate semantics: preserve copied AI roles from source session, or re-seed from workspace default.
- Decide and document template semantics: if template `aiRoles` are meant to matter, apply them explicitly during session creation; if not, remove them from the template contract.
- Ensure template-created sessions do not silently drop AI-role payloads unless that is the intended product rule.

Dependencies: Phase 1.

Risks and detection:

- Risk: users may expect template-specific role configs to survive template use.
- Detection: add tests around template apply/create behavior and compare persisted `session_ai_roles` after creation.

Rollback plan: keep Phase 1 fix, but defer template/duplicate behavior changes behind documented limitations.

**Phase 3: Remove misleading fallback behavior and harden validation**

Goal and done criteria: the renderer no longer carries the primary responsibility for making roles look configured, and bad workspace-default writes are rejected early.

Deliverables:

- Revisit `strategyStore.loadStrategy()` fallback logic so it is either removed or clearly limited to legacy/blank sessions only.
- Validate `saveWorkspaceDefaultModel` inputs against an existing configured AI provider account, not just arbitrary strings. (`electron/main/ipc/strategy.ts:123-131`)
- Update user-facing copy so it reflects the final behavior precisely.

Dependencies: Phase 1.

Risks and detection:

- Risk: removing read-time decoration could expose legacy bad rows.
- Detection: load older sessions in dev data and confirm they still render sensibly.

Rollback plan: keep validation, but temporarily retain the Strategy fallback for legacy sessions.

### 8. Risk Register

| #   | Risk                                                          | Likelihood | Impact | Mitigation                                                                     |
| --- | ------------------------------------------------------------- | ---------- | ------ | ------------------------------------------------------------------------------ |
| 1   | Existing tests rely on hardcoded Anthropic defaults           | High       | Medium | Update tests to assert workspace-default or blank-role behavior explicitly     |
| 2   | Duplicate/template semantics are ambiguous                    | Medium     | High   | Make the policy explicit before implementation and cover with tests            |
| 3   | Legacy sessions with old hardcoded values remain inconsistent | Medium     | Medium | Treat this as a forward-fix first; consider optional migration later if needed |
| 4   | Invalid workspace default values can still be saved           | Medium     | Medium | Add provider existence/category/configured validation on save                  |

### 9. Success Criteria

| Goal                                  | Metric                                                                      | Baseline                                            | Target                             | How Measured                                                           |
| ------------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------- | ---------------------------------- | ---------------------------------------------------------------------- |
| Workspace default seeds new sessions  | New-session AI roles persisted with workspace provider/model                | 0% for workspace defaults; 100% hardcoded Anthropic | 100% when workspace default exists | Repository/service test reading `session_ai_roles` after create        |
| No hidden UI-only fallback dependency | Session can start without visiting Strategy first                           | False for non-Anthropic setups                      | True                               | Integration test: set workspace default, create session, start session |
| Creation-path consistency             | Documented and tested behavior for plain create, template create, duplicate | Inconsistent/implicit                               | Explicit and covered               | Test matrix plus doc updates                                           |

Leading indicators:

- `SessionRepo.create()` tests no longer mention `provider-anthropic` as the default seed.
- Integration tests can start a new session after only configuring the workspace default provider/model.

Lagging indicators:

- Users no longer have to manually reassign every role after creating a session.

### 10. Open Questions

| #   | Question                                                                                                       | Owner   | Needed By            | Status                                                                                          |
| --- | -------------------------------------------------------------------------------------------------------------- | ------- | -------------------- | ----------------------------------------------------------------------------------------------- |
| 1   | Should duplicate sessions preserve source AI roles or re-seed from the current workspace default?              | Kenneth | Before Phase 2       | Resolved: preserve source AI roles                                                              |
| 2   | Should template `aiRoles` be applied during create, or should templates only carry session boundary data?      | Kenneth | Before Phase 2       | Resolved: template-created sessions should use workspace default seeding via normal create path |
| 3   | If no workspace default exists, should new sessions persist blank roles or a product-defined built-in default? | Kenneth | Before Phase 1 merge | Resolved: persist blank provider/model values                                                   |

### 11. Implementation Status

- [x] Phase 1 implemented on 2026-05-12.
- [x] New manual session creation now seeds `session_ai_roles` from `workspace_preferences.defaultModelProviderKey/defaultModelModelId`.
- [x] When no workspace default is configured, new sessions now persist blank `providerKey`/`modelId` instead of hardcoded Anthropic values.
- [x] Template-created sessions now inherit the same behavior because they still flow through the normal session-create path.
- [x] Legacy Strategy-page read-time fallback has been removed; Strategy now reflects persisted role values directly.
- [x] `saveWorkspaceDefaultModel` now validates that the selected provider exists, is an AI provider, and is configured before persisting it.
- [ ] Duplicate-session semantics intentionally remain unchanged; duplicates still preserve source-session AI roles.
- [ ] Template payload still carries `aiRoles`, but those values are not yet applied during create. That contract should be cleaned up in a follow-up if template-specific AI-role reuse is ever desired.

### 12. Alternatives Rejected

| Option                                        | Why Rejected                                                                   |
| --------------------------------------------- | ------------------------------------------------------------------------------ |
| Keep the current hardcoded Anthropic defaults | It directly contradicts the workspace default feature contract                 |
| Fix this purely in Zustand/renderer           | It does not repair the persisted source of truth used by preflight and runtime |
