#!/usr/bin/env bun
/**
 * Commit B — rename files per folder-restructure-plan.md.
 * Run after apply-restructure-renames.mjs
 */
import { renameSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const ROOT = join(new URL("..", import.meta.url).pathname);

const FILE_RENAMES = [
  // shared/ai
  ["electron/shared/ai/pipeline-config.ts", "electron/shared/ai/ai-phase-config.ts"],
  [
    "electron/shared/ai/effective-pipeline-config.ts",
    "electron/shared/ai/effective-ai-phase-config.ts",
  ],
  [
    "electron/shared/ai/pipeline-observability.ts",
    "electron/shared/ai/ai-phase-trace.ts",
  ],
  ["electron/shared/ai/pipeline-phase.ts", "electron/shared/ai/ai-phase.ts"],
  ["electron/shared/ai/pipeline-signals.ts", "electron/shared/ai/trade-signals.ts"],
  [
    "electron/shared/ai/signal-prompt-payload.ts",
    "electron/shared/ai/worker-prompt-payload.ts",
  ],
  [
    "electron/shared/ai/selector-pipeline-candidate.ts",
    "electron/shared/ai/selector-candidate.ts",
  ],
  // llm
  ["electron/main/services/llm/ai-runtime-types.ts", "electron/main/services/llm/llm-types.ts"],
  // pipeline prompting / execution / worker-tools
  [
    "electron/main/services/pipeline/prompting/prompt-envelope-builder.ts",
    "electron/main/services/pipeline/prompting/worker-prompt-builder.ts",
  ],
  [
    "electron/main/services/pipeline/prompting/preset-behavior-guidance.ts",
    "electron/main/services/pipeline/prompting/strategy-guidance.ts",
  ],
  [
    "electron/main/services/pipeline/execution/pipeline-spend-tracker.ts",
    "electron/main/services/pipeline/execution/ai-spend-tracker.ts",
  ],
  [
    "electron/main/services/pipeline/execution/engine-context-runner.ts",
    "electron/main/services/pipeline/execution/engine-prompt-injector.ts",
  ],
  [
    "electron/main/services/pipeline/worker-tools/tool-context-builder.ts",
    "electron/main/services/pipeline/worker-tools/worker-tool-resolver.ts",
  ],
  [
    "electron/main/services/pipeline/worker-tools/tool-factory-registry.ts",
    "electron/main/services/pipeline/worker-tools/worker-tool-factory.ts",
  ],
  [
    "electron/main/services/pipeline/phase-config-resolver.ts",
    "electron/main/services/pipeline/ai-phase-config-resolver.ts",
  ],
  // signal
  [
    "electron/main/services/signal/registry/engine-registry.ts",
    "electron/main/services/signal/registry/signal-engine-registry.ts",
  ],
  [
    "electron/main/services/signal/registry/register-pipeline-engines.ts",
    "electron/main/services/signal/registry/register-trade-signal-engines.ts",
  ],
  [
    "electron/main/services/signal/execution/execution-profile-engine.ts",
    "electron/main/services/signal/execution/trade-execution-profile.ts",
  ],
  [
    "electron/main/services/signal/execution/execution-profile-engine.test.ts",
    "electron/main/services/signal/execution/trade-execution-profile.test.ts",
  ],
  // pipeline implementations
  [
    "electron/main/services/pipeline/implementations/registry/cycle-plans.ts",
    "electron/main/services/pipeline/implementations/registry/register-analyses.ts",
  ],
  [
    "electron/main/services/pipeline/implementations/registry/phase-plans.ts",
    "electron/main/services/pipeline/implementations/registry/register-phases.ts",
  ],
  [
    "electron/main/services/pipeline/implementations/registry/interpreter.ts",
    "electron/main/services/pipeline/implementations/registry/analysis-dispatcher.ts",
  ],
  [
    "electron/main/services/pipeline/implementations/registry/registry.ts",
    "electron/main/services/pipeline/implementations/registry/analysis-resolver.ts",
  ],
  [
    "electron/main/services/pipeline/implementations/registry/types.ts",
    "electron/main/services/pipeline/implementations/registry/analysis-kinds.ts",
  ],
  [
    "electron/main/services/pipeline/implementations/trade/default-cycle.ts",
    "electron/main/services/pipeline/implementations/trade/default-analysis.ts",
  ],
  [
    "electron/main/services/pipeline/implementations/trade/default-cycle-stages.ts",
    "electron/main/services/pipeline/implementations/trade/default-analysis-steps.ts",
  ],
  [
    "electron/main/services/pipeline/implementations/trade/analysis-plans.ts",
    "electron/main/services/pipeline/implementations/trade/phase-analyses.ts",
  ],
  [
    "electron/main/services/pipeline/implementations/selector/plan.ts",
    "electron/main/services/pipeline/implementations/selector/selector-analysis.ts",
  ],
  [
    "electron/main/services/pipeline/implementations/selector/schemas.ts",
    "electron/main/services/pipeline/implementations/selector/selector-schemas.ts",
  ],
  [
    "electron/main/services/pipeline/implementations/__tests__/default-trade-cycle.test.ts",
    "electron/main/services/pipeline/implementations/__tests__/default-trade-analysis.test.ts",
  ],
  [
    "electron/main/services/pipeline/implementations/__tests__/trade-analysis-plans.test.ts",
    "electron/main/services/pipeline/implementations/__tests__/phase-analyses.test.ts",
  ],
  [
    "electron/main/services/pipeline/worker-tools/__tests__/tool-factory-registry.test.ts",
    "electron/main/services/pipeline/worker-tools/__tests__/worker-tool-factory.test.ts",
  ],
  // orchestration
  [
    "electron/main/services/orchestration/cycle/execution-step-runner.ts",
    "electron/main/services/orchestration/cycle/trading-step-runner.ts",
  ],
  [
    "electron/main/services/orchestration/cycle/__tests__/execution-step-runner.test.ts",
    "electron/main/services/orchestration/cycle/__tests__/trading-step-runner.test.ts",
  ],
  [
    "electron/main/services/orchestration/cycle/orchestrator-context.ts",
    "electron/main/services/orchestration/cycle/trading-cycle-context.ts",
  ],
];

for (const [fromRel, toRel] of FILE_RENAMES) {
  const from = join(ROOT, fromRel);
  const to = join(ROOT, toRel);
  if (!existsSync(from)) {
    if (existsSync(to)) {
      console.log("skip (already renamed)", toRel);
      continue;
    }
    console.warn("missing", fromRel);
    continue;
  }
  mkdirSync(dirname(to), { recursive: true });
  renameSync(from, to);
  console.log("renamed", fromRel, "->", toRel);
}

console.log("\nFile renames complete.");
