#!/usr/bin/env node
/** Pass 4: targeted fixes for remaining broken imports. */
import { readFileSync, writeFileSync, readdirSync, statSync } from "fs";
import { join, extname } from "path";

const ROOT = join(new URL("..", import.meta.url).pathname, "electron");

const GLOBAL = [
  ["../llm/ai-runtime-types", "../ai-runtime-types"],
  ["./llm/ai-runtime-types", "../../llm/ai-runtime-types"],
  ["../../execution/engine-context-runner", "./engine-context-runner"],
  ["../../runtime-retry", "../../llm/runtime-retry"],
  ["../../strategy-prompt-context", "../prompting/strategy-prompt-context"],
  ["./adapters/provider-adapter", "../../llm/adapters/provider-adapter"],
  ["./prompt-asset-loader", "../prompt-asset-loader"],
  ["../../broker/broker-registry", "../broker/broker-registry"],
  ["../../broker/broker-routing-service", "../broker/broker-routing-service"],
];

const ORCHESTRATION_CYCLE = [
  ["../analysis/orchestrator-context", "../cycle/orchestrator-context"],
  ["../analysis/trade/", "../cycle/trade/"],
];

const IMPLEMENTATIONS = [
  ["../phases/", "../../phases/"],
  ["../analysis/", "../../analysis/"],
  ["../execution/", "../../execution/"],
  ["../worker-tools/", "../../worker-tools/"],
  ["../plans/trade/", "../trade/"],
  ["../plans/selector/", "../selector/"],
  ["../register/", "./"],
  ["../unified/", "./"],
  ["../engine-input-builders/", "../inputs/"],
  ["../../../../session/", "../../../session/"],
];

const PIPELINE_DEPTH2 = [
  ["../../../infra/", "../../infra/"],
  ["../../../broker/", "../../broker/"],
  ["../../../session/", "../../session/"],
  ["../../../llm/", "../../llm/"],
  ["../../../orchestration/", "../../orchestration/"],
  ["../../../signal/", "../../signal/"],
  ["../../../../db/", "../../../db/"],
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

function apply(content, pairs) {
  for (const [from, to] of pairs) content = content.split(from).join(to);
  return content;
}

let changed = 0;
for (const file of walk(ROOT)) {
  let content = readFileSync(file, "utf8");
  const original = content;
  content = apply(content, GLOBAL);
  if (file.includes("/orchestration/")) content = apply(content, ORCHESTRATION_CYCLE);
  if (file.includes("/pipeline/implementations/")) content = apply(content, IMPLEMENTATIONS);
  if (file.match(/\/pipeline\/(core|analysis|phases|execution|prompting|worker-tools|definitions)\//))
    content = apply(content, PIPELINE_DEPTH2);
  if (content !== original) {
    writeFileSync(file, content);
    changed++;
  }
}

console.log(`Pass 4 fixed ${changed} files`);
