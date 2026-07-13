import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  backupSqliteDb,
  resolveAppDbPath,
  resolveBackupDir,
  writeLastBackupMeta,
} from "./db-backup";

describe("db-backup", () => {
  it("resolves a concrete app db path", () => {
    const resolved = resolveAppDbPath("/tmp/exva-userdata");
    expect(resolved).toBe(path.join("/tmp/exva-userdata", "exva.db"));
  });

  it("skips when source is missing", () => {
    const result = backupSqliteDb({
      sourcePath: path.join(os.tmpdir(), `exva-missing-${Date.now()}.db`),
      trigger: "manual",
    });
    expect(result.ok).toBe(true);
    expect(result.skipped).toBe(true);
  });

  it("copies an existing sqlite file into the backup dir", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "exva-backup-"));
    const source = path.join(dir, "exva.db");
    const backupDir = path.join(dir, "backups");
    fs.mkdirSync(backupDir, { recursive: true });
    fs.writeFileSync(source, "SQLite format 3\0");

    // Avoid mutating process.env: write directly into the default meta path's
    // sibling by using a unique source and asserting the copy succeeded.
    // Backup dir comes from env.dbBackupDir which is frozen at module load —
    // so we still write a file and verify backupSqliteDb's return path exists.
    const result = backupSqliteDb({ sourcePath: source, trigger: "manual" });
    expect(result.ok).toBe(true);
    expect(result.backupPath).toBeTruthy();
    if (!result.backupPath) throw new Error("expected backupPath");
    expect(fs.existsSync(result.backupPath)).toBe(true);
    expect(resolveBackupDir().length).toBeGreaterThan(0);
    writeLastBackupMeta({
      backedUpAt: result.backedUpAt,
      sourcePath: source,
      backupPath: result.backupPath,
      trigger: "manual",
    });
    fs.rmSync(dir, { recursive: true, force: true });
    try {
      fs.rmSync(result.backupPath, { force: true });
    } catch {
      // Best-effort cleanup of shared backup dir artifact.
    }
  });
});
