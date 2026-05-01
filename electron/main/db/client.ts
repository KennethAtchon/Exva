import fs from "node:fs";
import path from "node:path";
import BetterSqlite3 from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { env } from "../config/env";
import * as schema from "./schema";
import { runMigrations } from "./migrations";

export interface DbClient {
  sqlite: BetterSqlite3.Database;
  db: BetterSQLite3Database<typeof schema>;
}

export function createDbClient(userDataPath: string): DbClient {
  fs.mkdirSync(userDataPath, { recursive: true });
  const sqlite = new BetterSqlite3(env.dbPath ?? path.join(userDataPath, "exva.db"));
  sqlite.pragma("journal_mode = WAL");
  runMigrations(sqlite);
  return { sqlite, db: drizzle(sqlite, { schema }) };
}
