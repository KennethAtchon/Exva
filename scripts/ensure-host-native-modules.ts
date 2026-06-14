#!/usr/bin/env bun
/**
 * Ensures native modules in node_modules match the host Node.js ABI.
 *
 * Electron Forge / @electron/rebuild compiles better-sqlite3 for Electron's
 * NODE_MODULE_VERSION. Vitest runs on host Node, so after packaging or
 * electron-forge dev the binary may be stale and integration tests fail.
 *
 * Probing uses a Node subprocess — Bun cannot load better-sqlite3 directly.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const HOST_NODE = process.env.EXVA_HOST_NODE ?? "node";

const PROBE_SCRIPT = `
try {
  const BetterSqlite3 = require("better-sqlite3");
  const db = new BetterSqlite3(":memory:");
  db.close();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("NODE_MODULE_VERSION")) process.exit(2);
  console.error(message);
  process.exit(1);
}
`.trim();

type ProbeResult = "ok" | "version-mismatch";

function probeBetterSqlite3(): ProbeResult {
  const result = spawnSync(HOST_NODE, ["-e", PROBE_SCRIPT], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf-8",
  });

  if (result.status === 0) {
    return "ok";
  }
  if (result.status === 2) {
    return "version-mismatch";
  }

  const detail =
    result.stderr?.trim() ||
    result.stdout?.trim() ||
    `exit ${result.status ?? "unknown"}`;
  throw new Error(`better-sqlite3 probe failed: ${detail}`);
}

function rebuildBetterSqlite3(): void {
  console.log(`Rebuilding better-sqlite3 for host Node (${HOST_NODE})…`);
  const result = spawnSync("npm", ["rebuild", "better-sqlite3"], {
    cwd: ROOT,
    stdio: "inherit",
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error(
      `npm rebuild better-sqlite3 failed (exit ${result.status ?? "unknown"})`,
    );
  }
}

export function ensureHostNativeModules(): void {
  if (probeBetterSqlite3() === "ok") {
    return;
  }

  rebuildBetterSqlite3();

  if (probeBetterSqlite3() !== "ok") {
    throw new Error(
      "better-sqlite3 is still incompatible with host Node after rebuild",
    );
  }
}

if (import.meta.main) {
  ensureHostNativeModules();
  console.log("Host native modules OK");
}
