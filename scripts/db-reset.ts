/**
 * Dev-only: wipe Drizzle migration artifacts, regenerate from schema.ts,
 * and delete local SQLite files so the next app start applies a fresh 0000_initial.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = path.join(import.meta.dir, "..");
const DRIZZLE_DIR = path.join(ROOT, "electron/main/db/drizzle");

function resetMigrationsFolder(): void {
  fs.rmSync(DRIZZLE_DIR, { recursive: true, force: true });
  fs.mkdirSync(path.join(DRIZZLE_DIR, "meta"), { recursive: true });
  fs.writeFileSync(
    path.join(DRIZZLE_DIR, "meta/_journal.json"),
    `${JSON.stringify({ version: "7", dialect: "sqlite", entries: [] }, null, 2)}\n`,
  );

  const result = Bun.spawnSync(["bunx", "drizzle-kit", "generate", "--name", "initial"], {
    cwd: ROOT,
    stdout: "inherit",
    stderr: "inherit",
  });
  if (result.exitCode !== 0) {
    process.exit(result.exitCode ?? 1);
  }
}

function deleteSqliteFiles(dbPath: string): void {
  for (const file of [`${dbPath}`, `${dbPath}-wal`, `${dbPath}-shm`]) {
    if (!fs.existsSync(file)) continue;
    fs.rmSync(file);
    console.log(`removed ${file}`);
  }
}

function resetLocalDatabaseFiles(): void {
  const candidates = new Set<string>();
  if (process.env.EXVA_DB_PATH) {
    candidates.add(path.resolve(process.env.EXVA_DB_PATH));
  }

  const home = os.homedir();
  for (const dir of [
    path.join(home, "Library/Application Support/Exva"),
    path.join(home, "Library/Application Support/com.exva.app"),
    path.join(home, ".config/Exva"),
  ]) {
    candidates.add(path.join(dir, "exva.db"));
  }

  for (const dbPath of candidates) {
    deleteSqliteFiles(dbPath);
  }
}

console.log("Resetting Drizzle migrations from schema.ts…");
resetMigrationsFolder();
console.log("Removing local SQLite database files…");
resetLocalDatabaseFiles();
console.log("Done. Start the app (e.g. bun run dev) to migrate and seed.");
