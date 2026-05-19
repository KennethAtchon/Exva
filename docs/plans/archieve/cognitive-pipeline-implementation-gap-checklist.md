# Cognitive Pipeline — Remaining Implementation Checklist

> **Last audited against source:** 2026-05-18  
> **Scope:** only real remaining implementation work  
> **Goal:** hand this file to a coding agent, let it implement the remaining cognitive-pipeline spec work end-to-end, then test what breaks

All checklist items were completed on 2026-05-18.

## Agent rules

- Implement in the order below.
- If you complete an item, delete it from this file.
- If source code already proves an item is done, delete it instead of preserving it.
- Do not add legacy-detection code whose only job is to watch old names stay gone.
- Prefer deleting legacy code over wrapping it.

---

## Code reference map

| Area | Path |
|------|------|
| Replay runner | `electron/main/services/orchestration/cycle-replay-service.ts` |
| Replay tests | `electron/main/services/orchestration/__tests__/cycle-replay-service.test.ts` |
| Replay acceptance helpers | `electron/main/services/orchestration/__tests__/cycle-replay-acceptance.ts` |
| Replay fixtures | `electron/main/services/orchestration/__fixtures__/cycle-replay/` |
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
| CI workflow | `.github/workflows/cognitive-pipeline-ci.yml` |
