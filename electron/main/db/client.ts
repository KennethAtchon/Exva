import fs from "node:fs";
import path from "node:path";
import BetterSqlite3 from "better-sqlite3";
import {
  drizzle,
  type BetterSQLite3Database,
} from "drizzle-orm/better-sqlite3";
import { env } from "../config/env";
import { backupBeforeMigration } from "../services/infra/db-backup";
import * as schema from "./schema";
import { runMigrations } from "./migrations";

export interface DbClient {
  sqlite: BetterSqlite3.Database;
  db: BetterSQLite3Database<typeof schema>;
  dbPath: string;
}

export function resolveDbFilePath(userDataPath: string): string {
  return env.dbPath ?? path.join(userDataPath, "exva.db");
}

export function createDbClient(userDataPath: string): DbClient {
  fs.mkdirSync(userDataPath, { recursive: true });
  const dbPath = resolveDbFilePath(userDataPath);
  // Snapshot before any Drizzle migration mutates the daily DB.
  // Existing DB + failed backup must abort before migration.
  if (!env.isTest) {
    const sourceExists = fs.existsSync(dbPath);
    if (!sourceExists && env.dbPath?.trim()) {
      throw new Error(
        `EXVA_DB_PATH is set but database file is missing: ${dbPath}`,
      );
    }
    if (sourceExists) {
      const backup = backupBeforeMigration(dbPath);
      if (!backup.ok) {
        throw new Error(
          `Pre-migration backup failed; refusing to migrate: ${backup.error ?? "unknown error"}`,
        );
      }
    }
  }
  const sqlite = new BetterSqlite3(dbPath);
  sqlite.pragma("journal_mode = WAL");
  runMigrations(sqlite, { rebuildFromScratch: env.dbRebuildFromScratch });
  return { sqlite, db: drizzle(sqlite, { schema }), dbPath };
}
