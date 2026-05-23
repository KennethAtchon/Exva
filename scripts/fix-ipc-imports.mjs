#!/usr/bin/env node
/** Fix IPC subfolder relative imports after domain grouping. */
import { readFileSync, writeFileSync, readdirSync, statSync } from "fs";
import { join, extname } from "path";

const IPC = join(new URL("..", import.meta.url).pathname, "electron/main/ipc");

function walk(dir, files = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === "node_modules") continue;
    const st = statSync(p);
    if (st.isDirectory()) walk(p, files);
    else if (extname(name) === ".ts") files.push(p);
  }
  return files;
}

for (const file of walk(IPC)) {
  const rel = file.replace(IPC + "/", "");
  if (!rel.includes("/") || rel.startsWith("__tests__")) continue;
  let content = readFileSync(file, "utf8");
  const original = content;
  content = content
    .replace(/from "\.\/handle"/g, 'from "../handle"')
    .replace(/from "\.\/environment-guards"/g, 'from "../environment-guards"')
    .replace(/from "\.\.\/services\//g, 'from "../../services/')
    .replace(/from "\.\.\/db\//g, 'from "../../db/');
  if (content !== original) writeFileSync(file, content);
}

// Fix ipc test imports
const testFile = join(IPC, "__tests__/broker-account-helpers.test.ts");
let test = readFileSync(testFile, "utf8");
test = test.replace(
  /from "\.\.\/broker-account-helpers"/g,
  'from "../trading/broker-account-helpers"',
);
writeFileSync(testFile, test);

console.log("IPC imports fixed");
