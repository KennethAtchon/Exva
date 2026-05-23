#!/usr/bin/env bun
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

const ROOT = join(new URL("..", import.meta.url).pathname, "electron/main/services");

const READMES = {
  "llm/README.md": `# llm

Talks to LLM providers — one call at a time with retries, streaming, cost tracking, and tool-loop guards.

## Technical

- \`LLMRuntime\` is the main entry; \`PipelineRuntime\` delegates worker runs here.
- \`adapters/\` normalize Anthropic, OpenAI, and OpenRouter request/response shapes.
- \`llm-types.ts\` defines \`LLMMessage\`, \`LLMCallTrace\`, \`LLMRunResult\`.

## Terms

- **LLMCallTrace** — full record of one model invocation including tool steps.
`,

  "pipeline/README.md": `# pipeline

Runs multi-phase AI analysis: selector discovery, then per-instrument technical → fundamental → review → decision.

## Technical

- \`PipelineRuntime\` orchestrates \`AIPhaseRunner\` (single phase) and \`InstrumentAnalysisRunner\` (full trade analysis).
- \`implementations/\` holds trading-specific plans; \`core/\`, \`phases/\`, \`analysis/\`, \`execution/\` are generic framework.
- Worker prompts are inlined in \`worker-prompts.ts\`; \`buildWorkerPrompt\` assembles system/user messages.

## Flow

\`\`\`mermaid
sequenceDiagram
    participant Orchestrator
    participant PipelineRuntime
    participant AIPhaseRunner
    participant AIWorkerRunner
    Orchestrator->>PipelineRuntime: runPlan / runCycle
    PipelineRuntime->>AIPhaseRunner: run phase
    AIPhaseRunner->>AIWorkerRunner: run workers by batch
    AIWorkerRunner-->>Orchestrator: signals + traces
\`\`\`

## Terms

- **AIPhase** — definition of one analysis phase (workers, batches, finalize).
- **InstrumentAnalysis** — ordered steps analyzing one instrument through multiple phases.
`,

  "pipeline/core/README.md": `# pipeline/core

PipelineRuntime entry point, registries, and worker dependency scheduling.

## Technical

- \`worker-graph-scheduler.ts\` — \`scheduleWorkersByDependency\`.
- \`concurrent-group-runner.ts\` — \`runWorkersConcurrently\`.
`,

  "pipeline/phases/README.md": `# pipeline/phases

Defines and runs a single **AIPhase** — one pipeline phase like selector or technical.

## Technical

- \`AIPhaseRunner\` executes stages (\`AIWorkerBatch\`) with caching and input builders.
- Selector is registered as an \`AIPhase\`; trade sub-phases are separate \`AIPhase\` definitions.
`,

  "pipeline/analysis/README.md": `# pipeline/analysis

Runs one instrument through all trade analysis steps in order — technical through decision.

## Technical

- \`InstrumentAnalysisRunner\` executes \`InstrumentAnalysis\` definitions.
- \`default-analysis.ts\` is the production \`default-trade-cycle\` instrument analysis.
`,

  "pipeline/execution/README.md": `# pipeline/execution

Runs a single AI worker call: prompt build, tool assembly, LLM invoke, output validation.

## Technical

- \`runAIWorker\` in \`worker-executor.ts\`.
- \`AISpendTracker\` enforces phase/pipeline/session spend caps.
- \`engine-prompt-injector.ts\` injects signal engine results into prompts.
`,

  "pipeline/prompting/README.md": `# pipeline/prompting

Builds worker prompts from strategy context, presets, and task payloads.

## Technical

- \`buildWorkerPrompt\` returns \`LLMMessage[]\` ready for the provider adapter.
- \`strategy-guidance.ts\` derives preset behavior text from session config.
`,

  "pipeline/worker-tools/README.md": `# pipeline/worker-tools

Assembles the callable tool set each worker is allowed to use during its run.

## Technical

- \`worker-tool-factory.ts\` — \`buildWorkerTools\`, submit-output tool wiring.
- \`worker-tool-resolver.ts\` — \`resolveWorkerToolContext\` for session-scoped deps.
`,

  "pipeline/implementations/README.md": `# pipeline/implementations

Trading-specific analysis implementations: selector plan, trade cycle, caches, input builders, registries.

## Technical

- \`selector/\` — two-stage discovery + verification.
- \`trade/\` — default instrument analysis and per-phase aggregator plans.
- \`registry/\` — boot-time registration and \`AnalysisDispatcher\`.
`,

  "signal/README.md": `# signal

Deterministic post-LLM logic — aggregates worker outputs, scores selector candidates, runs policy engines.

## Technical

- \`aggregators/\` merge worker JSON into phase signals.
- \`scoring/\` ranks and filters selector candidates.
- \`registry/\` registers \`SignalEngineDefinition\` bindings (risk gate, order policy, etc.).

## Terms

- **SignalEngine** — deterministic function injected into worker prompts or run as analysis steps.
`,

  "search/README.md": `# search

Web search provider abstraction. Workers call \`search_web\`; this picks Brave, Tavily, DuckDuckGo, or MCP.

## Technical

- \`search-registry.ts\` resolves provider account → adapter.
- \`adapters/\` implement the common search interface.
`,

  "tools/README.md": `# tools

LLM-callable tool functions: market data, web fetch, search, Reddit, trending symbols.

## Technical

- Registered in \`worker-tool-factory.ts\` by tool id.
- Separate from \`search/\` — tools are the surface; search is provider infrastructure.
`,

  "replay/README.md": `# replay

Replays historical session cycles for debugging and CI acceptance fixtures.

## Technical

- \`cycle-replay-service.ts\` reconstructs phase outputs from persisted agent messages.
`,

  "analytics/README.md": `# analytics

Post-trade analytics — trade autopsy scoring and paper trading scorecards.

## Technical

- \`trade-autopsy-service.ts\` scores closed trades.
- \`paper-scorecard-service.ts\` aggregates paper performance.
`,

  "orchestration/README.md": `# orchestration

Live trading cycle loop — schedules selector runs, trade pipelines, gates, and broker orders per session tick.

## Technical

- \`cycle/agent-orchestrator.ts\` drives the per-session queue.
- \`TradingCycleContext\` holds step runners and deps for one cycle.
- \`policy/\` — pre-trade validation; \`lifecycle/\` — start/stop and trade monitor.
`,

  "broker/README.md": `# broker

Broker integration — order routing, balances, instrument normalization, mock/paper adapters.

## Technical

- \`broker-registry.ts\` maps session → adapter (Alpaca, Coinbase, Tradovate, Polymarket, mock).
`,

  "session/README.md": `# session

Session CRUD, runtime lifecycle, strategy context resolution, preflight checks, environment mode.

## Technical

- \`SessionRuntimeManager\` owns live \`SessionRuntime\` instances.
- \`environment-scope.ts\` resolves live/paper/mock mode.
`,

  "risk/README.md": `# risk

Pre-order risk checks — position size, exposure, capital reservation, exit policy, live readiness.

## Technical

- \`risk-engine.ts\` is the core guard invoked before broker placement.
`,

  "instrument/README.md": `# instrument

Instrument metadata cache — fetches and stores symbol metadata for sessions.

## Technical

- \`instrument-cache-service.ts\` wraps market repo lookups.
`,

  "infra/README.md": `# infra

Infrastructure primitives — structured logging, event bus, notifications, secrets/keychain access.

## Technical

- \`event-bus.ts\` fans out allowlisted events to renderer windows.
- \`secrets-service.ts\` reads credentials from OS keychain.
`,
};

for (const [rel, content] of Object.entries(READMES)) {
  const path = join(ROOT, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content.trim() + "\n");
  console.log("wrote", rel);
}

console.log("Done.");
