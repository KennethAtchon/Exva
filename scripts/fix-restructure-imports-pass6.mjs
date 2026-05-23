#!/usr/bin/env node
/** Pass 6: fix orchestration depths and implementations/ paths broken by prior passes. */
import { readFileSync, writeFileSync, readdirSync, statSync } from "fs";
import { join, extname } from "path";

const ROOT = join(new URL("..", import.meta.url).pathname, "electron/main/services");

function walk(dir, files = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, files);
    else if (extname(p) === ".ts") files.push(p);
  }
  return files;
}

function fixOrchestration(content, file) {
  // Undo bad pass5 policy/risk rewrites inside orchestration
  content = content.replace(
    /from "\.\.\/\.\.\/orchestration\/policy\//g,
    'from "../policy/',
  );

  const depth = file.split("/orchestration/")[1].split("/").length - 1;

  if (depth === 1) {
    // orchestration/*.ts or orchestration/__tests__/*
    content = content
      .replace(/from "\.\.\/risk\//g, 'from "../../risk/')
      .replace(/from "\.\.\/broker\//g, 'from "../../broker/');
  } else if (depth >= 2) {
    // orchestration/cycle/*, orchestration/lifecycle/*, etc.
    content = content
      .replace(/from "\.\.\/risk\//g, 'from "../../../risk/')
      .replace(/from "\.\.\/broker\//g, 'from "../../../broker/')
      .replace(/from "\.\.\/\.\.\/broker\//g, 'from "../../../broker/');
  }

  // selector lives under cycle/, not scoring/
  content = content
    .replace(/from "\.\.\/scoring\/run-selector"/g, 'from "../selector/run-selector"')
    .replace(/from "\.\.\/scoring\/run-selector"/g, 'from "../../selector/run-selector"');

  return content;
}

function fixPipeline(content, file) {
  if (file.includes("/pipeline/analysis/")) {
    content = content.replace(
      /from "\.\.\/\.\.\/\.\.\/llm\/ai-runtime-types"/g,
      'from "../../llm/ai-runtime-types"',
    );
  }
  if (file.includes("/pipeline/execution/") && !file.includes("/implementations/")) {
    content = content.replace(
      /from "\.\.\/\.\.\/\.\.\/llm\/ai-runtime-types"/g,
      'from "../../llm/ai-runtime-types"',
    );
  }
  if (file.includes("/pipeline/implementations/")) {
    content = content
      .replace(/from "\.\.\/\.\.\/\.\.\/\.\.\/llm\//g, 'from "../../../llm/')
      .replace(/from "\.\.\/\.\.\/\.\.\/\.\.\/signal\//g, 'from "../../../signal/')
      .replace(/from "\.\.\/\.\.\/pipeline\//g, 'from "../../')
      .replace(/from "\.\.\/input-builders\//g, 'from "../inputs/')
      .replace(/from "\.\.\/scoring\/plan"/g, 'from "../selector/plan"')
      .replace(/from "\.\.\/cycle\/types"/g, 'from "../../analysis/types"')
      .replace(/from "\.\.\/\.\.\/\.\.\/\.\.\/execution\//g, 'from "../../../execution/')
      .replace(/from "\.\.\/\.\.\/input-builders\//g, 'from "../inputs/')
      .replace(/\.\/engine-context-runner/g, "../execution/engine-context-runner");
  }
  if (file.endsWith("/pipeline/effective-pipeline-config.ts")) {
    content = content.replace(
      'from "../prompt-asset-loader"',
      'from "./prompt-asset-loader"',
    );
  }
  return content;
}

function fixLlm(content, file) {
  if (file.endsWith("/llm/provider-registry.ts")) {
    content = content.replace(
      'from "../../llm/adapters/provider-adapter"',
      'from "./adapters/provider-adapter"',
    );
  }
  return content;
}

let changed = 0;
for (const file of walk(ROOT)) {
  let content = readFileSync(file, "utf8");
  const original = content;
  if (file.includes("/orchestration/")) content = fixOrchestration(content, file);
  if (file.includes("/pipeline/")) content = fixPipeline(content, file);
  if (file.includes("/llm/")) content = fixLlm(content, file);
  if (content !== original) {
    writeFileSync(file, content);
    changed++;
  }
}

console.log(`Pass 6 fixed ${changed} files`);
