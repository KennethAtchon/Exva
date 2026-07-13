import BetterSqlite3 from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";
import { runMigrations } from "./migrations";
import type { DbClient } from "./client";

export function createTestDb(): DbClient {
  const sqlite = new BetterSqlite3(":memory:");
  sqlite.pragma("journal_mode = WAL");
  runMigrations(sqlite, { rebuildFromScratch: false });
  return {
    sqlite,
    db: drizzle(sqlite, { schema }),
    dbPath: ":memory:",
  };
}
