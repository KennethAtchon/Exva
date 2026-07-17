import { describe, expect, it, vi, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import BetterSqlite3 from "better-sqlite3";

function writeValidSqlite(filePath: string): void {
  const db = new BetterSqlite3(filePath);
  db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY);");
  db.close();
}

describe("createDbClient pre-migration backup gate", () => {
  const tmpDirs: string[] = [];

  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("../services/infra/db-backup");
    vi.doUnmock("./migrations");
    vi.doUnmock("../config/env");
    for (const dir of tmpDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("aborts before runMigrations when backup fails for an existing DB", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "exva-client-gate-"));
    tmpDirs.push(dir);
    writeValidSqlite(path.join(dir, "exva.db"));

    const runMigrations = vi.fn();
    vi.doMock("./migrations", () => ({ runMigrations }));
    vi.doMock("../services/infra/db-backup", () => ({
      backupBeforeMigration: () => ({
        ok: false,
        sourcePath: path.join(dir, "exva.db"),
        backupPath: null,
        backedUpAt: new Date().toISOString(),
        error: "destination unwritable",
      }),
    }));
    vi.doMock("../config/env", () => ({
      env: {
        isTest: false,
        dbPath: undefined,
        dbRebuildFromScratch: false,
      },
    }));

    const { createDbClient } = await import("./client");
    expect(() => createDbClient(dir)).toThrow(/Pre-migration backup failed/);
    expect(runMigrations).not.toHaveBeenCalled();
  });
});
