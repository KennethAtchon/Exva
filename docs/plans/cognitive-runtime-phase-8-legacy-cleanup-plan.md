# Cognitive Runtime Phase 8 Legacy Cleanup — Plan

> **Date:** 2026-05-17
> **Status:** Complete
> **Deciders:** Ken
> **Implements:** `docs/design/cognitive-pipeline-rearchitecture-spec.md` Phase 8
> **Depends on:** `docs/plans/cognitive-runtime-phase-7-decision-execution-plan.md`

---

## 1. Problem Statement

By the end of Phase 7, Exva should have all five phases running on typed, phase-first pipeline behavior. At that point, the remaining work is not architectural invention; it is removal of every old surface that still encodes the previous role-first, prose-coupled runtime. If those surfaces survive, the codebase will keep carrying stale concepts such as role-keyed AI config, prompt layers that explain tools/orchestration in prose, and helper code that only existed because phases used to pass text blobs around.

Phase 8 is the point where the migration becomes complete rather than merely operational. The goal is to leave one coherent architecture in the repository, docs, tests, preload surface, and renderer state.

---

## 2. Goals & Non-Goals

**Goals**

| # | Goal | Success Looks Like |
| --- | --- | --- |
| 1 | Remove remaining role-first runtime/config surfaces | No canonical runtime/config path depends on old role-keyed abstractions |
| 2 | Remove free-text inter-phase assumptions everywhere | No phase API or orchestrator path still treats prior AI output as a required string blob |
| 3 | Update docs and UI terminology to the final phase-first model | Engineering docs, config UI, and logs all describe phases as the product concept |
| 4 | Delete migration-only shims | Temporary adapters, raw-summary bridges, and compatibility helpers are gone |
| 5 | Leave the repo with one clear mental model | New engineers can discover the pipeline architecture from current code and docs only |

**Non-Goals**

| # | Non-Goal | Reason |
| --- | --- | --- |
| 1 | Adding new pipeline features | This is cleanup, not expansion |
| 2 | Re-litigating the architecture choice | Earlier phases already committed the direction |
| 3 | Large adjacent refactors outside AI pipeline scope | Keep this cleanup targeted |

---

## 3. Background & Context

Phase 1 already removed a large amount of role-specific runtime machinery, but the spec's deletion inventory is broader than just runtime methods. By Phase 8, the cleanup pass should audit at least these categories:

| Surface category | Examples to audit |
| --- | --- |
| Runtime helpers | Legacy parsers, finalizers, or role-oriented shims that no longer serve the live path |
| Shared schemas/types | Any type still modeling AI phases as old role/persona concepts where the product is now phase-first |
| Persistence and IPC | Temporary migration payloads or stale preload APIs |
| Renderer/editor state | Old `Role Profiles` semantics or state fields that survive behind new labels |
| Docs/tests | Engineering docs, plans, comments, and tests that still describe the old architecture as current |

The important rule is that Phase 8 should not be treated as optional polish. It is the phase that prevents the next refactor from starting from stale assumptions.

### Engine-system cleanup this phase must include

By Phase 8, the cleanup pass should verify not only that the AI phases are migrated, but that the engine system is the one canonical deterministic layer.

| Cleanup area | Expected end state |
| --- | --- |
| Runtime-to-engine calls | No important deterministic trading logic is hidden as direct helper calls when it should be an engine |
| DB-backed config access | Engines consume `SessionStrategyContextService`, `SessionAiPhasesRepo`, workspace prefs, and broker repos through explicit context boundaries |
| Lifecycle logic | `ExitPolicyEvaluator` / monitor behavior is described as part of the engine system, not as a disconnected side subsystem |
| Prompt context | Prompts do not silently carry config that engines should already have from DB-backed typed state |
| DevPanel semantics | Developer UI describes phases/workers/frontiers directly instead of only legacy role/run abstractions |

---

## 4. Research Summary

No new external research is needed. This phase is internal cleanup and documentation alignment after the architecture has already been implemented.

---

## 5. Options Considered

**Option A: Stop after Phase 7 and leave cleanup for later**

| Dimension | Assessment |
| --- | --- |
| Complexity | Lowest now |
| Reliability | Low |
| Long-term value | Poor |

**Option B: Do only code cleanup and defer docs/UI cleanup**

| Dimension | Assessment |
| --- | --- |
| Complexity | Medium |
| Reliability | Medium |
| Long-term value | Medium-low |

**Option C: Perform a full legacy cleanup pass across code, schemas, docs, and UI terminology**

| Dimension | Assessment |
| --- | --- |
| Complexity | Medium |
| Reliability | High |
| Long-term value | High |

---

## 6. Recommendation

**We recommend Option C: treat Phase 8 as a required completion phase that removes migration-only artifacts from every layer, not just from the runtime core.**

If the team stops at functional correctness, the repository will still teach the wrong architecture. Phase 8 is what makes the pipeline rewrite durable.

---

## 7. Implementation Plan

### Phase 8A: Audit the remaining legacy surface area — **Done**

Audit findings:
- `electron/shared/ai/ai-role-profile.ts` and `default-ai-role-profiles.ts` — no live importers in main/ or src/ → deleted.
- `electron/shared/domain.ts` — re-exported `AiRoleProfileDocument`, `AiRoleToolMode`, `AiRoleToolPolicyEntry` with no consumers → removed.
- `AgentRole` type in `enums.ts` — embedded in DB persistence (agent_runs, agent_messages), preload API, renderer. Renaming would require a DB migration. Kept intentionally; old values survive in `agentTypeSchema` for backward compat with stored records.
- All inter-phase text contracts (technicalAnalysis/fundamentalAnalysis strings, review.output.text) — confirmed absent.
- `run-agent-execute.ts` use of `selector-runtime-control` functions — live loop-detection logic for any agentic run. Kept.
- UI `AGENT_LABEL` map — already had both old and new phase names. No change needed.
- `cycle-replay-service.ts` legacy role-id compat — intentional backward compat with old DB records. Kept.

### Phase 8B: Remove code and schema leftovers — **Done**

Deliverables completed:
- Deleted `electron/shared/ai/ai-role-profile.ts` (normalizer, renderer, schema — all dead).
- Deleted `electron/shared/ai/default-ai-role-profiles.ts` (role profile factory — no consumers).
- Removed `AiRoleProfileDocument` / `AiRoleToolMode` / `AiRoleToolPolicyEntry` re-export from `electron/shared/domain.ts`.
- All inter-phase raw-string bridges confirmed absent from the orchestrator (technicalAnalysis, fundamentalAnalysis, review.output.text).

### Phase 8C: Align docs, preload, and renderer terminology — **Done**

Deliverables completed:
- `docs/design/cognitive-pipeline-rearchitecture-spec.md` status banner updated to Complete.
- `src/lib/mock.ts` — mock agent_type values updated to new phase names: technical, fundamental, review, decision. Old names (analyst_technical etc.) remain only in `agentTypeSchema` and the UI label map for DB backward compat.
- Preload API and renderer: no stale role-first naming found outside DB-compat surfaces.

### Phase 8D: Final regression and completion pass — **Done**

Grep results:
- `technicalAnalysis | fundamentalAnalysis | output\.text` in main/: zero hits.
- `AiRoleProfileDocument | ai-role-profile | default-ai-role-profiles` in electron/ + src/: zero hits.
- All 8 phases marked Complete in their respective plan docs.
- Design spec marked Complete.

---

## 8. Risk Register

| # | Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- | --- |
| 1 | Legacy role-first concepts survive in UI/API even after runtime cleanup | Medium | Medium | Audit preload/store/renderer surfaces explicitly |
| 2 | Cleanup scope balloons into unrelated refactors | Medium | Medium | Keep a strict delete/replace checklist tied to the pipeline rewrite |
| 3 | Engineers treat Phase 8 as optional and leave migration shims in place | High | High | Make cleanup items part of acceptance criteria, not backlog hygiene |

---

## 9. Success Criteria

| Goal | Metric | Baseline | Target | How Measured |
| --- | --- | --- | --- | --- |
| One architecture in code | Legacy runtime/config shims in main path | Present | Removed | Grep + code review |
| No text-coupled phase contracts | Raw AI string contracts between phases | Transitional presence | None | Grep + type review |
| Docs/UI match implementation | Stale role-first terminology | Possible | Removed or clearly historical | Doc/UI review |
| Migration debt closed | Temporary adapters still present | Possible | None | Final checklist |
| Engine system is canonical | Direct deterministic helper ownership bypassing engine boundaries | Possible | Removed or explicitly justified | Code review + grep |

---

## 10. Open Questions

| # | Question | Owner | Needed By | Status |
| --- | --- | --- | --- | --- |
| 1 | Should the final cleanup pass also rename any remaining persistent table or file names that are still historically role-oriented, or defer those if they add too much migration noise? | Ken | Before Phase 8B | Resolved: deferred. DB table/column renames (agent_runs.agent_type values) require a migration and backward-compat guard. The agentTypeSchema already includes both old and new values. Rename deferred to a future targeted migration. |
| 2 | Do we want one final architecture explainer doc after cleanup, or should the updated engineering docs be enough? | Ken | Before Phase 8C | Resolved: existing plan docs + updated spec are sufficient. No new explainer needed. |

---

## 11. Alternatives Rejected

| Option | Why Rejected |
| --- | --- |
| Declaring success after Phase 7 | Leaves stale architecture encoded across the repo |
| Cleaning code only and leaving docs/UI later | Guarantees future confusion about the current model |
