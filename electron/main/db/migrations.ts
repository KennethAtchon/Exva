import type Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema";
import { resolveMigrationsFolder } from "./migrations-folder";
import { runSeed } from "./seed";

export interface RunMigrationsOptions {
  rebuildFromScratch?: boolean;
}

function dropApplicationTables(sqlite: Database.Database): void {
  sqlite.pragma("foreign_keys = OFF");
  const tables = sqlite
    .prepare(
      `SELECT name FROM sqlite_master
       WHERE type = 'table'
         AND name NOT LIKE 'sqlite_%'`,
    )
    .all() as { name: string }[];

  for (const { name } of tables) {
    sqlite.exec(`DROP TABLE IF EXISTS "${name}"`);
  }
  sqlite.pragma("foreign_keys = ON");
}

export function runMigrations(
  sqlite: Database.Database,
  options?: RunMigrationsOptions,
): void {
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("journal_mode = WAL");

  if (options?.rebuildFromScratch) {
    dropApplicationTables(sqlite);
  }

  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: resolveMigrationsFolder() });
  runSeed(db, { sqlite, db });
}
