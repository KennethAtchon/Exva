#!/usr/bin/env node
/** Pass 7: fix depth-1 service modules (signal, tools, search, replay, session). */
import { readFileSync, writeFileSync, readdirSync, statSync } from "fs";
import { join, extname } from "path";

const SERVICES = join(new URL("..", import.meta.url).pathname, "electron/main/services");

const DEPTH1 = ["signal", "tools", "search", "replay", "llm", "instrument", "analytics"];

function walk(dir, files = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, files);
    else if (extname(p) === ".ts") files.push(p);
  }
  return files;
}

function fixDepth1(content) {
  return content
    .replace(/from "\.\.\/risk\//g, 'from "../../risk/')
    .replace(/from "\.\.\/broker\//g, 'from "../../broker/')
    .replace(/from "\.\.\/infra\//g, 'from "../../infra/')
    .replace(/from "\.\.\/orchestration\//g, 'from "../../orchestration/')
    .replace(/from "\.\.\/signal\//g, 'from "../../signal/')
    .replace(/from "\.\.\/pipeline\//g, 'from "../../pipeline/')
    .replace(/from "\.\.\/\.\.\/\.\.\/broker\//g, 'from "../../broker/')
    .replace(/from "\.\.\/\.\.\/broker\//g, 'from "../../broker/');
}

function fixPipelineTrade(content) {
  return content
    .replace(/from "\.\.\/\.\.\/\.\.\/analysis\//g, 'from "../../analysis/')
    .replace(/from "\.\.\/\.\.\/\.\.\/execution\//g, 'from "../../execution/')
    .replace(/from "\.\.\/\.\.\/\.\.\/definitions\//g, 'from "../../definitions/')
    .replace(/from "\.\.\/\.\.\/\.\.\/phases\//g, 'from "../../phases/');
}

function fixPipelinePhases(content) {
  return content
    .replace(/from "\.\.\/\.\.\/\.\.\/llm\//g, 'from "../../llm/')
    .replace(/from "\.\.\/registry\//g, 'from "../implementations/registry/');
}

function fixPipelineTests(content, file) {
  if (file.includes("/prompting/__tests__/")) {
    content = content
      .replace(/from "\.\.\/prompting\//g, 'from "../')
      .replace(/from "\.\.\/pipeline\/prompting\//g, 'from "../');
  }
  if (file.includes("/execution/__tests__/")) {
    content = content.replace(
      /from "\.\.\/\.\.\/llm\/ai-runtime-types"/g,
      'from "../../../llm/ai-runtime-types"',
    );
  }
  return content;
}

function fixOrchestrationTests(content, file) {
  if (file.includes("/orchestration/__tests__/")) {
    content = content.replace(
      /from "\.\.\/\.\.\/\.\.\/broker\//g,
      'from "../../broker/',
    );
  }
  if (file.includes("/orchestration/cycle/__tests__/")) {
    content = content.replace(
      /from "\.\.\/\.\.\/\.\.\/db\//g,
      'from "../../../../db/',
    );
  }
  return content;
}

function fixRegistry(content) {
  return content.replace(
    /from "\.\.\/cycle\/types"/g,
    'from "../../analysis/types"',
  );
}

let changed = 0;
for (const file of walk(SERVICES)) {
  let content = readFileSync(file, "utf8");
  const original = content;
  const top = file.split("/services/")[1]?.split("/")[0];
  if (top && DEPTH1.includes(top)) content = fixDepth1(content);
  if (file.includes("/pipeline/implementations/trade/")) content = fixPipelineTrade(content);
  if (file.includes("/pipeline/phases/")) content = fixPipelinePhases(content);
  if (file.includes("/pipeline/implementations/registry/registry.ts")) content = fixRegistry(content);
  if (file.includes("/pipeline/implementations/selector/plan.ts")) {
    content = content.replace(
      /from "\.\.\/\.\.\/\.\.\/execution\//g,
      'from "../../execution/',
    );
  }
  content = fixPipelineTests(content, file);
  content = fixOrchestrationTests(content, file);
  if (content !== original) {
    writeFileSync(file, content);
    changed++;
  }
}

console.log(`Pass 7 fixed ${changed} files`);
