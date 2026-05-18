# Cognitive Runtime Phase 3 Selector Cleanup — Plan

> **Date:** 2026-05-17
> **Status:** Draft
> **Deciders:** Ken
> **Implements:** `docs/design/cognitive-pipeline-rearchitecture-spec.md` Phase 3
> **Depends on:** `docs/plans/cognitive-runtime-phase-2-selector-cutover-plan.md`

---

## 1. Problem Statement

Once Phase 2 cuts selector behavior over to the new deterministic pipeline, Exva will still have a second category of work left: deleting the transitional selector machinery that made the old architecture possible. Today that legacy surface is spread across `selector-runtime-control.ts`, selector-specific parsing in `worker-executor.ts`, selector settings and profile fields in shared/session config, and tests that still encode the old step-loop mental model. If those surfaces remain after the new selector path is live, the codebase will continue to communicate two different selector architectures at the same time.

That is dangerous for two reasons. First, dead or half-dead selector code invites accidental reuse when later phases are implemented. Second, old user-configurable selector knobs such as step-budget-oriented settings imply that the product still exposes prompt-loop behavior that the new pipeline no longer honors. Phase 3 exists to make the selector rewrite irreversible in the main path.

---

## 2. Goals & Non-Goals

**Goals**

| # | Goal | Success Looks Like |
| --- | --- | --- |
| 1 | Delete selector transitional control code | `selector-runtime-control.ts` is gone from the main path |
| 2 | Remove selector-specific runtime parsing shims | Live selector execution no longer depends on `parseInstrumentSelection()` in generic worker execution |
| 3 | Remove obsolete selector settings and role-profile fields | Session/profile state no longer advertises step-loop settings the selector pipeline does not use |
| 4 | Rewrite tests around the new model | Tests assert typed candidate/scoring/submission behavior instead of step-heuristic behavior |
| 5 | Keep only meaningful defense-in-depth | Any selector checks that survive do so because they are still structurally useful, not because the old path needs patching |

**Non-Goals**

| # | Non-Goal | Reason |
| --- | --- | --- |
| 1 | Further selector behavior redesign | Phase 2 already owns the cutover |
| 2 | Technical/fundamental/review/decision changes | Later phases own those migrations |
| 3 | Reworking every session strategy field unrelated to selector | Keep this cleanup surgical |

---

## 3. Background & Context

### Legacy selector surfaces likely to remain after Phase 2

| File | Legacy surface | Cleanup action |
| --- | --- | --- |
| `electron/main/services/ai/ai-runtime/selector-runtime-control.ts` | Discovery/verification/commit step heuristics | Delete |
| `electron/main/services/ai/pipeline-runtime/execution/worker-executor.ts` | Selector-specific terminal parse branch | Remove or isolate behind non-selector generic finalizer mechanism |
| `electron/shared/ai/default-ai-role-profiles.ts` | Selector-oriented profile defaults | Remove selector runtime behavior fields that no longer exist |
| `electron/shared/ai/ai-role-profile.ts` | Selector settings schema helpers | Remove obsolete selector runtime settings |
| `electron/shared/validation/schemas.ts`, `electron/shared/domain/workspace.ts`, `src/lib/exva.ts` | Persisted/public selector settings shape | Drop fields that only existed for the old loop |
| `src/store/strategyStore.ts`, `electron/preload/exva-api.ts` | Renderer/preload selector settings exposure | Remove dead state and API exposure |

### Cleanup principle

Phase 3 should not keep old selector controls around merely because they are already persisted. The product model after the cutover is phase-first and deterministic. If a field exists only to steer step-loop behavior, it should be removed instead of preserved as inert config.

---

## 4. Research Summary

No new external research is needed for this phase. This is a local deletion and consolidation pass following the already-decided architecture.

---

## 5. Options Considered

**Option A: Keep old selector settings and helpers as dormant compatibility code**

| Dimension | Assessment |
| --- | --- |
| Complexity | Low initially |
| Reliability | Low |
| Long-term value | Poor |

Risks: stale code survives and later phases copy it.

**Option B: Delete runtime code but keep public selector config fields with no-op semantics**

| Dimension | Assessment |
| --- | --- |
| Complexity | Medium |
| Reliability | Medium-low |
| Long-term value | Low |

Risks: user-facing config becomes misleading.

**Option C: Remove the legacy selector architecture completely**

| Dimension | Assessment |
| --- | --- |
| Complexity | Medium |
| Reliability | High |
| Long-term value | High |

Risks: requires touching more UI/schema/test surfaces now, but eliminates ambiguity.

---

## 6. Recommendation

**We recommend Option C: complete the selector migration by deleting the old control surfaces, config fields, and tests once the new selector pipeline is stable.**

The rule for this phase is simple: if a file, field, helper, or test exists only because selector used to be a prompt-driven step loop, remove it. The codebase should describe one selector architecture, not two.

---

## 7. Implementation Plan

### Phase 3A: Delete selector runtime-control code

Goal: remove the procedural selector step-control layer from the codebase.

Done criteria: no production selector path imports or references `selector-runtime-control.ts`.

Deliverables:

- Delete `selector-runtime-control.ts`.
- Remove any selector prepare-step wiring that only served the old single-worker loop.
- Remove selector-specific terminal parsing assumptions from generic worker execution.

Dependencies: Phase 2 selector cutover live and verified.

Risks: tests may still rely on legacy trace shapes.

Rollback plan: restore the deleted files only if Phase 2 cutover is reverted.

### Phase 3B: Remove dead selector config and schema surfaces

Goal: stop exposing obsolete selector runtime settings to persistence, API, and UI layers.

Done criteria: no shared/public schema advertises selector loop-control settings that the new selector does not use.

Deliverables:

- Remove old selector runtime fields from shared AI profile/config types.
- Remove matching preload/API payload fields.
- Remove renderer state that only supported the old selector controls.
- Decide whether `aiPickerEnabled` remains as a high-level mode toggle; remove the rest if they are loop-specific.

Dependencies: Phase 3A runtime cleanup.

Risks: hidden session/template flows may still deserialize old selector fields.

Rollback plan: restore only the schema fields needed to reopen the app if a missed consumer appears.

### Phase 3C: Rewrite tests and docs to the new selector model

Goal: make the test suite and engineering docs encode the new selector architecture.

Done criteria: selector tests verify candidate typing, ranking, filtering, and submission; no test is asserting the old phase-switch heuristics.

Deliverables:

- Replace step-heuristic tests with pipeline/service tests.
- Update engineering docs that still describe selector as a broad loop agent.
- Remove obsolete references from plan/spec docs if they are now misleading implementation details.

Dependencies: Phase 3B cleanup.

Risks: stale comments and docs survive because they are not exercised by tests.

Rollback plan: none beyond restoring deleted docs from version control if needed.

---

## 8. Risk Register

| # | Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- | --- |
| 1 | Some selector settings still matter for session creation or mode selection | Medium | Medium | Distinguish high-level mode toggles from step-loop knobs before deleting fields |
| 2 | Generic worker execution still quietly assumes selector-style terminal behavior | Medium | High | Add runtime tests for non-selector terminal/object/text paths after cleanup |
| 3 | Template/import paths still depend on removed schema fields | Medium | Medium | Run session/template smoke tests after schema cleanup |

---

## 9. Success Criteria

| Goal | Metric | Baseline | Target | How Measured |
| --- | --- | --- | --- | --- |
| Remove selector control layer | `selector-runtime-control.ts` usage | Present | Absent | Grep |
| Remove selector parsing shim | Selector-only branch in generic worker execution | Present | Absent or isolated to generic finalizer infrastructure | Code review |
| Remove obsolete selector settings | Shared/public schema fields for old loop controls | Present | Absent | Grep + schema review |
| Test model matches architecture | Tests assert step heuristics | Present | Replaced by pipeline/service assertions | Test review |

---

## 10. Open Questions

| # | Question | Owner | Needed By | Status |
| --- | --- | --- | --- | --- |
| 1 | Is `aiPickerEnabled` still the right top-level mode flag name after selector cleanup? | Ken | Before Phase 3B | Open |
| 2 | Should selector finalization be modeled as a generic pipeline finalizer abstraction before removing the selector-specific worker-executor branch? | Ken | Before Phase 3A | Open |

---

## 11. Alternatives Rejected

| Option | Why Rejected |
| --- | --- |
| Leaving compatibility code dormant | Keeps two mental models alive |
| Keeping no-op selector settings in UI/API | Misleads future engineers and operators |
