#!/usr/bin/env node
/** Pass 5: ai-runtime-types paths, signal/scoring, tools depth. */
import { readFileSync, writeFileSync, readdirSync, statSync } from "fs";
import { join, extname } from "path";

const ROOT = join(new URL("..", import.meta.url).pathname, "electron");

const REPLACEMENTS = [
  ['from "../../../../ai-runtime-types"', 'from "../../../../llm/ai-runtime-types"'],
  ['from "../../../ai-runtime-types"', 'from "../../../llm/ai-runtime-types"'],
  ['from "../../ai-runtime-types"', 'from "../../llm/ai-runtime-types"'],
  ['from "../selector/', 'from "../scoring/'],
  ['from "../../engines/', 'from "../'],
  // worker-tools → tools (depth: pipeline/worker-tools = 2 under services)
  ['from "../tools/', 'from "../../tools/'],
  // signal/scoring depth fixes
  ['from "../../../orchestration/policy/', 'from "../../orchestration/policy/'],
  ['from "../../../risk/', 'from "../../risk/'],
  ['from "../../../broker/adapters/', 'from "../../broker/adapters/'],
  ['from "../../../analysis/types"', 'from "../../pipeline/analysis/types"'],
  ['from "../../../phases/types"', 'from "../../pipeline/phases/types"'],
  ['from "../../../pipeline-discovery-config"', 'from "../../pipeline/pipeline-discovery-config"'],
  ['from "../../../../execution/trace-assembler"', 'from "../../execution/trace-assembler"'],
  ['from "../pipeline/prompting/prompt-envelope-builder"', 'from "../prompting/prompt-envelope-builder"'],
  ['from "../policy/', 'from "../../orchestration/policy/'],
  ['from "../../risk/', 'from "../risk/'],
  ['from "../../core/types"', 'from "../core/types"'],
  ['from "../../broker/mock/', 'from "../../../broker/mock/'],
  ['from "../../broker/adapters/mock-adapter"', 'from "../../../broker/adapters/mock-adapter"'],
  // implementations/registry self-imports broken by ./ replacement
  ['from "./cycle-plans"', 'from "./cycle-plans"'],
];

function walk(dir, files = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === "node_modules" || name === ".git") continue;
    if (statSync(p).isDirectory()) walk(p, files);
    else if (extname(p) === ".ts") files.push(p);
  }
  return files;
}

let changed = 0;
for (const file of walk(ROOT)) {
  let content = readFileSync(file, "utf8");
  const original = content;
  for (const [from, to] of REPLACEMENTS) content = content.split(from).join(to);
  if (content !== original) {
    writeFileSync(file, content);
    changed++;
  }
}
console.log(`Pass 5 fixed ${changed} files`);
