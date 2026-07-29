import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { env } from "../../config/env";
import { createLogger } from "./log";
import { safeJsonParse } from "./safe-json-parse";

const logger = createLogger("db-backup");

const META_PATH = path.join(os.homedir(), ".exva", "last-backup.json");
const DEFAULT_BACKUP_DIR = path.join(os.homedir(), ".exva", "backups");
const KEEP_COUNT = 30;

export interface BackupResult {
  ok: boolean;
  sourcePath: string;
  backupPath: string | null;
  backedUpAt: string;
  error?: string;
  skipped?: boolean;
  reason?: string;
}

export interface LastBackupMeta {
  backedUpAt: string;
  sourcePath: string;
  backupPath: string;
  trigger: "pre_migration" | "nightly" | "manual" | "script";
}

/** Resolve the daily DB the same way the app / db-reset do. */
export function resolveAppDbPath(userDataPath?: string): string {
  if (env.dbPath?.trim()) {
    return path.resolve(env.dbPath.trim());
  }
  if (userDataPath) {
    return path.join(userDataPath, "exva.db");
  }
  const home = os.homedir();
  const candidates = [
    path.join(home, "Library/Application Support/exva", "exva.db"),
    path.join(home, "Library/Application Support/Exva", "exva.db"),
    path.join(home, "Library/Application Support/com.exva.app", "exva.db"),
    path.join(home, ".config/Exva", "exva.db"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  const fallback = candidates[0];
  if (!fallback) {
    throw new Error("resolveAppDbPath: no candidate paths");
  }
  return fallback;
}

export function resolveBackupDir(): string {
  const fromEnv = env.dbBackupDir?.trim();
  return fromEnv ? path.resolve(fromEnv) : DEFAULT_BACKUP_DIR;
}

export function readLastBackupMeta(): LastBackupMeta | null {
  try {
    if (!fs.existsSync(META_PATH)) return null;
    const raw = safeJsonParse<LastBackupMeta>(
      fs.readFileSync(META_PATH, "utf8"),
      undefined,
      "db-backup.meta",
    );
    if (!raw?.backedUpAt || !raw.backupPath) return null;
    return raw;
  } catch {
    return null;
  }
}

export function writeLastBackupMeta(meta: LastBackupMeta): void {
  fs.mkdirSync(path.dirname(META_PATH), { recursive: true });
  fs.writeFileSync(META_PATH, `${JSON.stringify(meta, null, 2)}\n`);
}

function stamp(): string {
  return new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z");
}

function pruneBackups(backupDir: string): void {
  if (!fs.existsSync(backupDir)) return;
  const files = fs
    .readdirSync(backupDir)
    .filter((name) => /^exva-\d{8}T?\d{6}Z?\.(db|sqlite)$/.test(name))
    .map((name) => ({
      name,
      full: path.join(backupDir, name),
      mtime: fs.statSync(path.join(backupDir, name)).mtimeMs,
    }))
    .sort((a, b) => b.mtime - a.mtime);
  for (const stale of files.slice(KEEP_COUNT)) {
    try {
      fs.rmSync(stale.full, { force: true });
    } catch {
      // Best-effort prune.
    }
  }
}

function trySqlite3Backup(sourcePath: string, destPath: string): boolean {
  try {
    execFileSync("sqlite3", [sourcePath, `.backup '${destPath}'`], {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 120_000,
    });
    return fs.existsSync(destPath);
  } catch {
    return false;
  }
}

/** Open backup read-only and require PRAGMA quick_check = ok. */
export function validateSqliteBackup(backupPath: string): void {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require("better-sqlite3") as typeof import("better-sqlite3");
  const db = new Database(backupPath, { readonly: true, fileMustExist: true });
  try {
    const rows = db.pragma("quick_check") as Array<{ quick_check: string }>;
    const result = rows[0]?.quick_check ?? "";
    if (result !== "ok") {
      throw new Error(`backup quick_check failed: ${result || "empty"}`);
    }
  } finally {
    db.close();
  }
}

/**
 * Snapshot the SQLite DB. Prefer `sqlite3 .backup` (online-safe); fall back
 * to copying the main file (+ WAL/SHM when present).
 */
export function backupSqliteDb(options: {
  sourcePath: string;
  trigger: LastBackupMeta["trigger"];
  /** When true, missing source is hard failure (configured EXVA_DB_PATH). */
  requireSource?: boolean;
}): BackupResult {
  const backedUpAt = new Date().toISOString();
  const sourcePath = path.resolve(options.sourcePath);
  if (!fs.existsSync(sourcePath)) {
    if (options.requireSource || Boolean(env.dbPath?.trim())) {
      return {
        ok: false,
        sourcePath,
        backupPath: null,
        backedUpAt,
        error: `configured database missing: ${sourcePath}`,
      };
    }
    return {
      ok: true,
      sourcePath,
      backupPath: null,
      backedUpAt,
      skipped: true,
      reason: "source_missing",
    };
  }

  const backupDir = resolveBackupDir();
  fs.mkdirSync(backupDir, { recursive: true });
  const backupPath = path.join(backupDir, `exva-${stamp()}.db`);

  try {
    const copied = trySqlite3Backup(sourcePath, backupPath);
    if (!copied) {
      fs.copyFileSync(sourcePath, backupPath);
      for (const suffix of ["-wal", "-shm"] as const) {
        const side = `${sourcePath}${suffix}`;
        if (fs.existsSync(side)) {
          fs.copyFileSync(side, `${backupPath}${suffix}`);
        }
      }
    }

    validateSqliteBackup(backupPath);

    pruneBackups(backupDir);
    writeLastBackupMeta({
      backedUpAt,
      sourcePath,
      backupPath,
      trigger: options.trigger,
    });
    logger.info(
      { sourcePath, backupPath, trigger: options.trigger },
      "db backup written",
    );
    return { ok: true, sourcePath, backupPath, backedUpAt };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.error({ err, sourcePath }, "db backup failed");
    try {
      if (fs.existsSync(backupPath)) fs.rmSync(backupPath, { force: true });
    } catch {
      // Best-effort cleanup of invalid backup.
    }
    return {
      ok: false,
      sourcePath,
      backupPath: null,
      backedUpAt,
      error,
    };
  }
}

export interface RestoreResult {
  ok: boolean;
  backupPath: string;
  targetPath: string;
  restoredAt: string;
  error?: string;
}

/**
 * Restore a backup file onto `targetPath`. Caller must not hold the live DB
 * open on that path (tests / offline ops only — GUI restore requires quit).
 */
export function restoreSqliteDb(options: {
  backupPath: string;
  targetPath: string;
}): RestoreResult {
  const restoredAt = new Date().toISOString();
  const backupPath = path.resolve(options.backupPath);
  const targetPath = path.resolve(options.targetPath);
  try {
    if (!fs.existsSync(backupPath)) {
      return {
        ok: false,
        backupPath,
        targetPath,
        restoredAt,
        error: "backup_missing",
      };
    }
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.copyFileSync(backupPath, targetPath);
    for (const suffix of ["-wal", "-shm"] as const) {
      const side = `${backupPath}${suffix}`;
      const dest = `${targetPath}${suffix}`;
      if (fs.existsSync(side)) {
        fs.copyFileSync(side, dest);
      } else if (fs.existsSync(dest)) {
        fs.rmSync(dest, { force: true });
      }
    }
    logger.info({ backupPath, targetPath }, "db restore written");
    return { ok: true, backupPath, targetPath, restoredAt };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.error({ err, backupPath, targetPath }, "db restore failed");
    return { ok: false, backupPath, targetPath, restoredAt, error };
  }
}
