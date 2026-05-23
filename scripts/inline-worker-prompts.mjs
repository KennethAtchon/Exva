#!/usr/bin/env node
/**
 * Change 8: inline worker prompt markdown into TypeScript constants.
 * Reads pipeline/prompts/*.md and writes worker-prompts.ts.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(
  new URL("..", import.meta.url).pathname,
  "electron/main/services/pipeline",
);
const PROMPTS_DIR = path.join(ROOT, "prompts");
const OUT = path.join(ROOT, "worker-prompts.ts");

function toConstName(relPath) {
  // selector-workers/web-scout -> SELECTOR_WEB_SCOUT_PROMPT
  const base = relPath.replace(/\.md$/, "").replace(/\//g, "_").replace(/-/g, "_");
  return base.toUpperCase() + "_PROMPT";
}

function stripVersion(raw) {
  return raw.replace(/^<!--\s*version:\s*[\d.]+\s*-->\s*/i, "").trim();
}

function toTemplateLiteral(content) {
  return (
    "`" +
    content
      .replace(/\\/g, "\\\\")
      .replace(/`/g, "\\`")
      .replace(/\$\{/g, "\\${") +
    "`"
  );
}

function walkMd(dir, base = "") {
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) out.push(...walkMd(p, path.join(base, name)));
    else if (name.endsWith(".md")) {
      const rel = path.join(base, name.replace(/\.md$/, ""));
      const body = stripVersion(fs.readFileSync(p, "utf8"));
      out.push({ rel, constName: toConstName(rel), body });
    }
  }
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

const prompts = walkMd(PROMPTS_DIR);
const lines = [
  "// Auto-generated from pipeline/prompts/ — do not edit by hand.",
  "// Re-run: node scripts/inline-worker-prompts.mjs",
  "",
];

for (const { constName, body } of prompts) {
  lines.push(`export const ${constName} = ${toTemplateLiteral(body)};`, "");
}

fs.writeFileSync(OUT, lines.join("\n"));

const map = Object.fromEntries(prompts.map((p) => [p.rel, p.constName]));
console.log(`Wrote ${prompts.length} prompts to ${OUT}`);
console.log(JSON.stringify(map, null, 2));
