#!/usr/bin/env node
/**
 * Commit A import path fixes for folder restructure.
 * Updates file paths only — no symbol renames.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "fs";
import { join, extname } from "path";

const ROOT = new URL("..", import.meta.url).pathname;

const REPLACEMENTS = [
  // Shared catalog → instruments
  ["@electron/shared/catalog/", "@electron/shared/instruments/"],
  ["@shared/catalog/", "@shared/instruments/"],
  ["shared/catalog/", "shared/instruments/"],

  // Pipeline internal plan/ restructuring (most specific first)
  ["pipeline-runtime/plan/unified/", "pipeline/implementations/registry/"],
  ["pipeline-runtime/plan/register/", "pipeline/implementations/registry/"],
  ["pipeline-runtime/plan/registry/", "pipeline/implementations/registry/"],
  ["pipeline-runtime/plan/engine-input-builders/", "pipeline/implementations/inputs/"],
  ["pipeline-runtime/plan/input-builders/", "pipeline/implementations/inputs/"],
  ["pipeline-runtime/plan/plans/selector/", "pipeline/implementations/selector/"],
  ["pipeline-runtime/plan/plans/trade/", "pipeline/implementations/trade/"],
  ["pipeline-runtime/plan/cache/", "pipeline/implementations/cache/"],
  ["pipeline-runtime/plan/engine/", "pipeline/execution/"],
  ["pipeline-runtime/plan/phase/", "pipeline/phases/"],
  ["pipeline-runtime/plan/cycle/", "pipeline/analysis/"],
  ["pipeline-runtime/plan/", "pipeline/implementations/"],
  ["pipeline-runtime/context/", "pipeline/worker-tools/"],
  ["pipeline-runtime/", "pipeline/"],

  // Relative plan/ paths within pipeline
  ["/plan/unified/", "/implementations/registry/"],
  ["/plan/register/", "/implementations/registry/"],
  ["/plan/registry/", "/implementations/registry/"],
  ["/plan/engine-input-builders/", "/implementations/inputs/"],
  ["/plan/input-builders/", "/implementations/inputs/"],
  ["/plan/plans/selector/", "/implementations/selector/"],
  ["/plan/plans/trade/", "/implementations/trade/"],
  ["/plan/cache/", "/implementations/cache/"],
  ["/plan/engine/", "/execution/"],
  ["/plan/phase/", "/phases/"],
  ["/plan/cycle/", "/analysis/"],
  ["/plan/", "/implementations/"],
  ["/context/", "/worker-tools/"],

  // services/ai/ split
  ["services/ai/pipeline-runtime/", "services/pipeline/"],
  ["services/ai/ai-runtime/", "services/llm/"],
  ["services/ai/adapters/", "services/llm/adapters/"],
  ["services/ai/engines/selector/", "services/signal/scoring/"],
  ["services/ai/engines/", "services/signal/"],
  ["services/ai/search/", "services/search/"],
  ["services/ai/tools/", "services/tools/"],
  ["services/ai/model-pricing", "services/llm/model-pricing"],
  ["services/ai/provider-registry", "services/llm/provider-registry"],
  ["services/ai/resolve-run-cost", "services/llm/resolve-run-cost"],
  ["services/ai/prompt-asset-loader", "services/pipeline/prompt-asset-loader"],
  ["services/ai/strategy-prompt-context", "services/pipeline/prompting/strategy-prompt-context"],
  ["services/ai/tool-use-harness", "services/pipeline/execution/tool-use-harness"],
  ["services/ai/", "services/llm/"],

  // Relative ./ai/ paths from services/
  ["./ai/pipeline-runtime/", "./pipeline/"],
  ["./ai/ai-runtime/", "./llm/"],
  ["./ai/adapters/", "./llm/adapters/"],
  ["./ai/engines/selector/", "./signal/scoring/"],
  ["./ai/engines/", "./signal/"],
  ["./ai/search/", "./search/"],
  ["./ai/tools/", "./tools/"],
  ["./ai/model-pricing", "./llm/model-pricing"],
  ["./ai/provider-registry", "./llm/provider-registry"],
  ["./ai/resolve-run-cost", "./llm/resolve-run-cost"],
  ["./ai/prompt-asset-loader", "./pipeline/prompt-asset-loader"],
  ["./ai/strategy-prompt-context", "./pipeline/prompting/strategy-prompt-context"],
  ["./ai/tool-use-harness", "./pipeline/execution/tool-use-harness"],
  ["./ai/", "./llm/"],

  // Parent-relative ai paths (../../ai/, ../../../ai/, etc.)
  ["../../../ai/pipeline-runtime/", "../../../pipeline/"],
  ["../../../ai/ai-runtime/", "../../../llm/"],
  ["../../../ai/adapters/", "../../../llm/adapters/"],
  ["../../../ai/engines/selector/", "../../../signal/scoring/"],
  ["../../../ai/engines/", "../../../signal/"],
  ["../../../ai/search/", "../../../search/"],
  ["../../../ai/tools/", "../../../tools/"],
  ["../../ai/pipeline-runtime/", "../../pipeline/"],
  ["../../ai/ai-runtime/", "../../llm/"],
  ["../../ai/adapters/", "../../llm/adapters/"],
  ["../../ai/engines/selector/", "../../signal/scoring/"],
  ["../../ai/engines/", "../../signal/"],
  ["../../ai/search/", "../../search/"],
  ["../../ai/tools/", "../../tools/"],
  ["../ai/pipeline-runtime/", "../pipeline/"],
  ["../ai/ai-runtime/", "../llm/"],
  ["../ai/adapters/", "../llm/adapters/"],
  ["../ai/engines/selector/", "../signal/scoring/"],
  ["../ai/engines/", "../signal/"],
  ["../ai/search/", "../search/"],
  ["../ai/tools/", "../tools/"],

  // ai-runtime path segments (after ai-runtime folder renamed to llm)
  ["/ai-runtime/ai-runtime-types", "/llm/ai-runtime-types"],
  ["/ai-runtime/index", "/llm/index"],
  ["/ai-runtime/runtime", "/llm/runtime"],
  ["/ai-runtime/", "/llm/"],
  ["../../ai-runtime/", "../../llm/"],
  ["../../../ai-runtime/", "../../../llm/"],
  ["../ai-runtime/", "../llm/"],

  // Orchestration moves
  ["orchestration/replay/", "replay/"],
  ["orchestration/post-trade/", "analytics/"],
  ["./orchestration/replay/", "./replay/"],
  ["./orchestration/post-trade/", "./analytics/"],

  // Workspace dissolve
  ["services/workspace/environment-scope", "services/session/environment-scope"],
  ["./workspace/environment-scope", "./session/environment-scope"],
  ["../workspace/environment-scope", "../session/environment-scope"],

  // engines/selector → signal/scoring (relative within signal)
  ["engines/selector/", "signal/scoring/"],
  ["/engines/selector/", "/signal/scoring/"],
  ["../engines/selector/", "../scoring/"],
  ["../../engines/selector/", "../../scoring/"],

  // engines/ → signal/ (when not already signal/)
  ["/engines/aggregators/", "/signal/aggregators/"],
  ["/engines/registry/", "/signal/registry/"],
  ["/engines/execution/", "/signal/execution/"],
  ["../engines/aggregators/", "../aggregators/"],
  ["../engines/registry/", "../registry/"],
  ["../engines/execution/", "../execution/"],
  ["../../engines/", "../../signal/"],
];

function walk(dir, files = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === "node_modules" || name === ".git" || name === "out" || name === "dist") continue;
    const st = statSync(p);
    if (st.isDirectory()) walk(p, files);
    else if ([".ts", ".tsx", ".json", ".md"].includes(extname(name))) files.push(p);
  }
  return files;
}

let changed = 0;
for (const file of walk(ROOT)) {
  if (file.includes("fix-restructure-imports.mjs")) continue;
  let content = readFileSync(file, "utf8");
  const original = content;
  for (const [from, to] of REPLACEMENTS) {
    content = content.split(from).join(to);
  }
  if (content !== original) {
    writeFileSync(file, content);
    changed++;
  }
}

console.log(`Updated ${changed} files`);
