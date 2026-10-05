// Size budgets from docs/ARCHITECTURE.md. `bun run verify` fails when one is exceeded.
// Raising a budget means editing BUDGETS here AND writing the reason in ARCHITECTURE.md.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
export const BUDGETS = {
  engine: 8_000,
  ui: 9_000,
  desktop: 600,
  shared: 600,
  tables: 12,
  endpoints: 30,
};

/** Non-blank, non-comment lines of TypeScript, excluding tests. */
export function loc(dir: string): number {
  let total = 0;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (!["node_modules", "dist", "test", "e2e"].includes(name)) total += loc(path);
      continue;
    }
    if (!/\.(ts|tsx)$/.test(name) || /\.test\.tsx?$/.test(name)) continue;
    total += readFileSync(path, "utf8")
      .split("\n")
      .filter((l) => {
        const t = l.trim();
        return t && !t.startsWith("//") && !t.startsWith("/*") && !t.startsWith("*");
      }).length;
  }
  return total;
}

export function measure() {
  const sql = readFileSync(join(ROOT, "engine/src/store/migrations/001_init.sql"), "utf8");
  const server = readFileSync(join(ROOT, "engine/src/api/server.ts"), "utf8");
  const routeBlock = server.slice(
    server.indexOf("export function routes"),
    server.indexOf("export interface ApiOptions"),
  );
  return {
    engine: loc(join(ROOT, "engine/src")),
    ui: loc(join(ROOT, "ui/src")),
    desktop: loc(join(ROOT, "desktop/src")),
    shared: loc(join(ROOT, "shared")),
    tables: (sql.match(/CREATE TABLE/g) ?? []).length,
    endpoints: (routeBlock.match(/\b(GET|POST|PUT|PATCH|DELETE):/g) ?? []).length,
  };
}

if (import.meta.main) {
  const m = measure();
  let failed = false;
  for (const [key, limit] of Object.entries(BUDGETS)) {
    const value = m[key as keyof typeof m];
    const over = value > limit;
    failed ||= over;
    console.log(`${over ? "✗" : "✓"} ${key.padEnd(10)} ${String(value).padStart(6)} / ${limit}`);
  }
  if (failed) {
    console.error(
      "\nOver budget. Simplify, or raise the budget with a written reason in docs/ARCHITECTURE.md.",
    );
    process.exit(1);
  }
}
