# AI Model Configuration Guide

> **Status:** Phase 1 complete — phase-first runtime is canonical.
> **Design spec:** [`docs/design/cognitive-pipeline-rearchitecture-spec.md`](../design/cognitive-pipeline-rearchitecture-spec.md)
> **Implementation plan:** [`docs/plans/cognitive/cognitive-runtime-phase-1-redesign-plan.md`](../plans/cognitive/cognitive-runtime-phase-1-redesign-plan.md)

## Where configuration lives

| Concern | Source |
| --- | --- |
| Phase provider/model/prompt | `session_ai_phases` → `PhaseConfigResolver` |
| Per-worker overrides | `session_ai_phase_workers` |
| Spend caps (worker / phase / pipeline / session) | `electron/shared/ai/pipeline-config.ts`, `PHASE_DEFAULTS`, `riskConfig.maxAiSpendUsd` |
| Scoring weights & risk rules | `electron/shared/ai/pipeline-config.ts` |
| Worker prompts | `electron/main/services/ai/pipeline-runtime/prompts/**/*.md` |
| Worker tools & engine bindings | `WorkerDefinition` in phase definitions / `pipeline-discovery-config.ts` |
| Search MCP fallback | `WorkerDefinition.toolConfig.search_web.fallbackProviderId` |
| Business/risk context (not prompts) | `SessionStrategyContextService` |

## Runtime path

```
Strategy UI / DB
  → PhaseConfigResolver
  → PipelineRuntime.run()
  → WorkerExecutor (tools, engines, spend caps)
  → ProviderAdapter.runAgent
  → agent_runs / agent_messages
```

## Adding a worker (normal path)

1. Add a `WorkerDefinition` entry (tools, optional `engines`, optional `toolConfig`) in the phase definition or `pipeline-discovery-config.ts`.
2. Add a markdown prompt under `pipeline-runtime/prompts/<phase>-workers/`.
3. Add/adjust unit tests if behavior is non-trivial.

Do **not** edit `AgentOrchestrator`, `PipelineRuntime`, or provider adapters unless you are introducing a new platform primitive (tool, engine, or output contract).

## Legacy note

Pre-Phase-1 role-based configuration (`session_ai_roles`, `electron/prompts/`, `prompt-pack-builder`) has been removed from the main path. Historical references in archived plans are not authoritative.
