#!/usr/bin/env node
/**
 * Pass 3: fix relative import depths after folder restructure.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "fs";
import { join, extname, relative, dirname } from "path";

const ROOT = join(new URL("..", import.meta.url).pathname);
const SERVICES = join(ROOT, "electron/main/services");

function walk(dir, files = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === "node_modules" || name === ".git") continue;
    if (statSync(p).isDirectory()) walk(p, files);
    else if (extname(p) === ".ts") files.push(p);
  }
  return files;
}

function depthUnderServices(file) {
  const rel = relative(SERVICES, dirname(file));
  return rel === "" ? 0 : rel.split("/").length;
}

function dbPrefix(depth) {
  return "../".repeat(depth + 1) + "db/";
}

function mainPrefix(depth) {
  return "../".repeat(depth + 1);
}

function fixFile(file) {
  let content = readFileSync(file, "utf8");
  const original = content;
  const depth = depthUnderServices(file);
  const db = dbPrefix(depth);
  const up = mainPrefix(depth);

  // Pipeline plan/ internal renames
  content = content
    .replace(/from "(\.\.\/)+phase\//g, (m) => m.replace("/phase/", "/phases/"))
    .replace(/from "(\.\.\/)+cycle\//g, (m) => m.replace("/cycle/", "/analysis/"))
    .replace(/from "(\.\.\/)+engine\//g, (m) => m.replace("/engine/", "/execution/"));

  // ai-runtime-types → llm/ai-runtime-types (relative from services tree)
  content = content.replace(
    /from "((?:\.\.\/)+)ai-runtime-types"/g,
    (_, ups) => `from "${ups}llm/ai-runtime-types"`,
  );

  // Fix over-shallow db imports (../../db/ when we need deeper)
  if (depth >= 2) {
    content = content.replace(/from "\.\.\/\.\.\/db\//g, `from "${db}`);
  }

  // Fix over-deep main/service sibling imports (../../../../broker → correct depth)
  for (const sibling of [
    "broker",
    "session",
    "infra",
    "orchestration",
    "llm",
    "pipeline",
    "signal",
    "search",
    "tools",
    "risk",
    "instrument",
    "analytics",
    "replay",
  ]) {
    const re = new RegExp(`from "(?:\\.\\./){4,}${sibling}/`, "g");
    content = content.replace(re, `from "${up}${sibling}/`);
  }

  // llm/runtime.ts and similar top-level service files
  if (file.endsWith("/llm/runtime.ts")) {
    content = content
      .replace('from "../provider-registry"', 'from "./provider-registry"')
      .replace(
        'from "../prompt-asset-loader"',
        'from "../pipeline/prompt-asset-loader"',
      )
      .replace('from "../../broker/', 'from "../broker/')
      .replace('from "../../session/', 'from "../session/');
  }

  if (file.endsWith("/llm/runtime-retry.ts")) {
    content = content.replace('from "../../infra/log"', 'from "../infra/log"');
  }

  // pipeline sibling imports to llm
  if (file.includes("/pipeline/")) {
    content = content
      .replace(/from "\.\.\/\.\.\/provider-registry"/g, 'from "../../llm/provider-registry"')
      .replace(/from "\.\.\/provider-registry"/g, 'from "../llm/provider-registry"')
      .replace(/from "\.\.\/\.\.\/prompt-asset-loader"/g, 'from "../prompt-asset-loader"')
      .replace(/from "\.\.\/prompt-asset-loader"/g, 'from "./prompt-asset-loader"');
  }

  // app-services replay path
  if (file.endsWith("/app-services.ts")) {
    content = content.replace(
      'from "../replay/cycle-replay-service"',
      'from "./replay/cycle-replay-service"',
    );
  }

  // orchestration ai-runtime-types at wrong path
  if (file.includes("/orchestration/")) {
    content = content.replace(
      /from "\.\.\/\.\.\/ai-runtime-types"/g,
      'from "../../llm/ai-runtime-types"',
    );
    content = content.replace(
      /from "\.\.\/\.\.\/\.\.\/ai-runtime-types"/g,
      'from "../../../llm/ai-runtime-types"',
    );
  }

  // analysis/types worker-tools path
  content = content.replace(
    /from "\.\.\/\.\.\/worker-tools\//g,
    'from "../worker-tools/',
  );

  if (content !== original) writeFileSync(file, content);
}

for (const file of walk(SERVICES)) fixFile(file);
console.log("Pass 3 complete");
