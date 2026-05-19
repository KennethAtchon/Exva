# Cognitive Pipeline — Remaining Implementation Checklist

> **Last audited against source:** 2026-05-18  
> **Scope:** only real remaining implementation work  
> **Goal:** hand this file to a coding agent, let it implement the remaining cognitive-pipeline spec work end-to-end, then test what breaks

Completed and stale items were removed after checking the repo.

## Agent rules

- Implement in the order below.
- If you complete an item, delete it from this file.
- If source code already proves an item is done, delete it instead of preserving it.
- Do not add legacy-detection code whose only job is to watch old names stay gone.
- Prefer deleting legacy code over wrapping it.

---

## Phase 2 — Selector cleanup

- [ ] Add selector replay fixtures for the remaining cutover edge cases.
  Cases to cover: provider retry recovery, malformed terminal output
  Files: `electron/main/services/orchestration/__tests__/cycle-replay-service.test.ts`
  Done when: selector replay covers these cases with exact `InstrumentSelection` expectations.

---

## Phase 4 — Decision/execution completion

- [ ] Add replay expectations for per-strategy execution outputs.
  Files: replay fixture/tests
  Done when: fixture-driven tests assert `size`, `orderType`, `limitPrice`, `stopLoss`, and `takeProfit` behavior through the deterministic execution path.

---

## Phase 5 — Legacy role-model deletion

- [ ] Remove legacy role values from shared/runtime-facing unions once persisted runtime data is phase-first.
  Files: `electron/shared/domain/enums.ts`, `src/lib/schemas.ts`
  Legacy values to remove: `analyst_technical`, `analyst_fundamental`, `reviewer`, `decision_maker`, `instrument_selector`
  Done when: shared types accept canonical phase names only where the new pipeline is the source of truth.

- [ ] Delete `normalizeRole()` legacy mapping from DevPanel.
  File: `src/pages/DevPanel.tsx`
  Done when: DevPanel filters, colors, and labels operate directly on canonical phase names.

- [ ] Delete legacy label/display adapters in renderer surfaces.
  Files: `src/components/custom-ui/index.tsx`, `src/pages/Dashboard.tsx`, `src/pages/TradeDetail.tsx`, `src/pages/CostBreakdown.tsx`
  Done when: renderer role labels/colors no longer translate old agent vocabulary.

---

## Phase 7 — CI and acceptance execution

- [ ] Add CI coverage for prompt-rule and acceptance tests.
  Files: create workflow under `.github/workflows/`, run `vitest` coverage that includes `pipeline-worker-prompts.test.ts` and replay acceptance tests
  Done when: pull requests run the prompt-budget/denylist tests and the replay acceptance suite automatically.

- [ ] Add measurable acceptance checks for pipeline health.
  Metrics to assert: selector submission rate, zero use of AI-authored sizing fields, per-cycle cost ceiling
  Done when: acceptance fixtures fail automatically when these metrics regress.

---

## Suggested execution order

1. Finish remaining selector edge-case replay coverage.
2. Add replay expectations for deterministic execution outputs.
3. Delete legacy role-model UI/schema/runtime vocabulary.
4. Wire the acceptance suite into CI.

---

## Code reference map

| Area | Path |
|------|------|
| Replay runner | `electron/main/services/orchestration/cycle-replay-service.ts` |
| Replay tests | `electron/main/services/orchestration/__tests__/cycle-replay-service.test.ts` |
| Runtime adapter | `electron/main/services/ai/adapters/run-agent-execute.ts` |
| Tool loop helpers | `electron/main/services/ai/ai-runtime/tool-loop-guard.ts` |
| Selector phase | `electron/main/services/ai/pipeline-runtime/definitions/selector.phase.ts` |
| Technical phase | `electron/main/services/ai/pipeline-runtime/definitions/technical.phase.ts` |
| Fundamental phase | `electron/main/services/ai/pipeline-runtime/definitions/fundamental.phase.ts` |
| Execution engine | `electron/main/services/ai/engines/execution-profile-engine.ts` |
| Execution tests | `electron/main/services/ai/engines/execution-profile-engine.test.ts` |
| Shared signals | `electron/shared/ai/pipeline-signals.ts` |
| DevPanel | `src/pages/DevPanel.tsx` |
| Shared schema | `src/lib/schemas.ts` |
