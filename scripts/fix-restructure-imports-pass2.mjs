#!/usr/bin/env node
/** Fix incorrect paths from over-aggressive replacement. */
import { readFileSync, writeFileSync, readdirSync, statSync } from "fs";
import { join, extname } from "path";

const ROOT = new URL("..", import.meta.url).pathname;

const REPLACEMENTS = [
  // llm/pipeline was wrong — pipeline is sibling of llm
  ["llm/pipeline/", "pipeline/"],
  ["./llm/pipeline/", "./pipeline/"],
  ["../llm/pipeline/", "../pipeline/"],
  ["../../llm/pipeline/", "../../pipeline/"],
  ["../../../llm/pipeline/", "../../../pipeline/"],

  // llm/adapters self-references
  ["../llm/ai-runtime-types", "../ai-runtime-types"],
  ["../llm/tool-loop-guard", "../tool-loop-guard"],
  ["../llm/runtime", "../runtime"],
  ["../llm/runtime-trace", "../runtime-trace"],
  ["../llm/runtime-retry", "../runtime-retry"],

  // orchestration replay/autopsy
  ["./replay/cycle-replay-service", "../replay/cycle-replay-service"],
  ["./post-trade/trade-autopsy-service", "../analytics/trade-autopsy-service"],

  // ipc broker helpers
  ["./broker-account-helpers", "../trading/broker-account-helpers"],

  // analytics db paths (was orchestration/post-trade — one level deeper)
  ["../../../db/", "../../db/"],
  ["../../llm/provider-registry", "../llm/provider-registry"],
];

function walk(dir, files = [], skipDocs = true) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === "node_modules" || name === ".git" || name === "out") continue;
    if (skipDocs && p.includes("/docs/")) continue;
    const st = statSync(p);
    if (st.isDirectory()) walk(p, files, skipDocs);
    else if ([".ts", ".tsx"].includes(extname(name))) files.push(p);
  }
  return files;
}

let changed = 0;
for (const file of walk(ROOT)) {
  if (file.includes("fix-") && file.endsWith(".mjs")) continue;
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

console.log(`Fixed ${changed} files`);
