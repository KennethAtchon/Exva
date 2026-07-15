import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import BetterSqlite3 from "better-sqlite3";
import {
  backupSqliteDb,
  resolveAppDbPath,
  resolveBackupDir,
  writeLastBackupMeta,
} from "./db-backup";

function writeValidSqlite(filePath: string): void {
  const db = new BetterSqlite3(filePath);
  db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY); INSERT INTO t VALUES (1);");
  db.close();
}

describe("db-backup", () => {
  it("resolves a concrete app db path", () => {
    const resolved = resolveAppDbPath("/tmp/exva-userdata");
    expect(resolved).toBe(path.join("/tmp/exva-userdata", "exva.db"));
  });

  it("skips when source is missing (first-run)", () => {
    const result = backupSqliteDb({
      sourcePath: path.join(os.tmpdir(), `exva-missing-${Date.now()}.db`),
      trigger: "manual",
    });
    expect(result.ok).toBe(true);
    expect(result.skipped).toBe(true);
  });

  it("fails when requireSource is set and file is missing", () => {
    const result = backupSqliteDb({
      sourcePath: path.join(
        os.tmpdir(),
        `exva-required-missing-${Date.now()}.db`,
      ),
      trigger: "pre_migration",
      requireSource: true,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/missing/i);
  });

  it("copies an existing sqlite file into the backup dir", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "exva-backup-"));
    const source = path.join(dir, "exva.db");
    writeValidSqlite(source);

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
