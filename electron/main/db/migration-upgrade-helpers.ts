import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import BetterSqlite3 from "better-sqlite3";
import { expect } from "vitest";
import { resolveMigrationsFolder } from "./migrations-folder";
import { runMigrations } from "./migrations";
import { requireJsonParse } from "../services/infra/safe-json-parse";

type Journal = {
  version: string;
  dialect: string;
  entries: Array<{
    idx: number;
    version: string;
    when: number;
    tag: string;
    breakpoints: boolean;
  }>;
};

/** Copy drizzle folder with journal truncated through `throughTag` (inclusive). */
export function createTruncatedMigrationsFolder(throughTag: string): string {
  const source = resolveMigrationsFolder();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "exva-mig-"));
  fs.cpSync(source, dest, { recursive: true });

  const journalPath = path.join(dest, "meta", "_journal.json");
  const journal = requireJsonParse<Journal>(
    fs.readFileSync(journalPath, "utf8"),
    undefined,
    "Invalid drizzle migration journal JSON",
  );
  const cut = journal.entries.findIndex((e) => e.tag === throughTag);
  if (cut < 0) {
    throw new Error(`tag ${throughTag} not in journal`);
  }
  journal.entries = journal.entries.slice(0, cut + 1);
  fs.writeFileSync(journalPath, `${JSON.stringify(journal, null, 2)}\n`);
  return dest;
}

export function schemaFingerprint(sqlite: BetterSqlite3.Database): string {
  const tables = sqlite
    .prepare(
      `SELECT name, sql FROM sqlite_master
       WHERE type IN ('table', 'index')
         AND name NOT LIKE 'sqlite_%'
         AND name NOT LIKE '__drizzle_%'
       ORDER BY type, name`,
    )
    .all() as Array<{ name: string; sql: string | null }>;
  return JSON.stringify(tables);
}

export function assertIntegrity(sqlite: BetterSqlite3.Database): void {
  const integrity = sqlite.pragma("integrity_check", { simple: true });
  expect(integrity).toBe("ok");
  const fk = sqlite.prepare("PRAGMA foreign_key_check").all();
  expect(fk).toEqual([]);
}

/**
 * Build a DB stopped after drizzle tag `throughTag`, then finish upgrade to
 * head using the full migrations folder (including TS backfill/drop).
 */
export function upgradeFromTag(throughTag: string): {
  sqlite: BetterSqlite3.Database;
  dbPath: string;
  cleanup: () => void;
} {
  const truncated = createTruncatedMigrationsFolder(throughTag);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "exva-upgrade-"));
  const dbPath = path.join(dir, "exva.db");
  const sqlite = new BetterSqlite3(dbPath);
  sqlite.pragma("journal_mode = WAL");

  // Drizzle-only through the truncation point (avoids premature backfill/drop
  // when session_strategy_configs does not exist yet).
  runMigrations(sqlite, {
    migrationsFolder: truncated,
    drizzleOnly: true,
  });

  // Finish to head with full folder + seed/backfill/drop.
  runMigrations(sqlite, {
    migrationsFolder: resolveMigrationsFolder(),
  });

  return {
    sqlite,
    dbPath,
    cleanup: () => {
      sqlite.close();
      fs.rmSync(dir, { recursive: true, force: true });
      fs.rmSync(truncated, { recursive: true, force: true });
    },
  };
}
