import type Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema";
import { resolveMigrationsFolder } from "./migrations-folder";
import { runSeed } from "./seed";
import {
  assertSessionStrategyConfigPreservation,
  backfillSessionStrategyConfigs,
} from "./session-strategy-config-backfill";
import { dropLegacySessionConfigTables } from "./drop-legacy-session-config-tables";

export interface RunMigrationsOptions {
  rebuildFromScratch?: boolean;
  /** Override migrations folder (upgrade-fixture tests). */
  migrationsFolder?: string;
  /** Apply Drizzle SQL only; skip seed/backfill/drop (upgrade staging). */
  drizzleOnly?: boolean;
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
  migrate(db, {
    migrationsFolder: options?.migrationsFolder ?? resolveMigrationsFolder(),
  });

  if (options?.drizzleOnly) {
    return;
  }

  runSeed(db, { sqlite, db, dbPath: ":memory:" });
  // 0009 + 0010: backfill, preserve assertions, and drop in one transaction.
  sqlite.transaction(() => {
    backfillSessionStrategyConfigs(sqlite);
    assertSessionStrategyConfigPreservation(sqlite);
    dropLegacySessionConfigTables(sqlite);
  })();
}
